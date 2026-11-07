#!/usr/bin/env python3
"""APA Hachioji West cleaning system. Python 3.10+; standard library only."""
import os, json, sqlite3, secrets, hashlib, hmac, csv, io, mimetypes, threading
from datetime import datetime, date, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from http.cookies import SimpleCookie
from pathlib import Path
from zoneinfo import ZoneInfo

BASE=Path(__file__).resolve().parent
DB=Path(os.environ.get('APA_DB_PATH',str(BASE/'cleaning.sqlite3')))
PORT=int(os.environ.get('PORT','8080'))
ADMIN_PASSWORD=os.environ.get('APA_ADMIN_PASSWORD','')
CHECKER_PASSWORD=os.environ.get('APA_CHECKER_PASSWORD','')
JST=ZoneInfo('Asia/Tokyo')
ROOMS={201:'D',202:'S',203:'S',204:'D',205:'S',206:'S',207:'D',208:'TR',209:'TR',301:'D',302:'S',303:'S',304:'D',305:'S',306:'S',307:'D',308:'S',309:'D',310:'S',311:'S',312:'D',313:'D',401:'S',402:'D',403:'S',404:'S',405:'D',406:'S',407:'D',408:'S',409:'S',410:'D',411:'D',501:'D',502:'S',503:'D',504:'S',505:'S',506:'D',507:'T',508:'T',509:'T',510:'T',601:'D',602:'S',603:'D',604:'S',605:'S',606:'D',607:'T',608:'T',609:'T',610:'T'}
STAFF=['AMRIT','HUMA','YAMU KUMARI','RITA','KABITA','GOBIN','SANGITA']
CATS=('OUT','KY','STAY','ECO','HIGAERI')

def now(): return datetime.now(JST).isoformat(timespec='seconds')
def today(): return datetime.now(JST).date().isoformat()
def conn():
 c=sqlite3.connect(DB,timeout=15,isolation_level=None)
 c.row_factory=sqlite3.Row;c.execute('PRAGMA busy_timeout=15000');c.execute('PRAGMA foreign_keys=ON');c.execute('PRAGMA journal_mode=WAL');return c

def init():
 DB.parent.mkdir(parents=True,exist_ok=True)
 with conn() as c:
  c.executescript('''CREATE TABLE IF NOT EXISTS staff(id INTEGER PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS rooms(number INTEGER PRIMARY KEY, type TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,work_date TEXT NOT NULL,room INTEGER NOT NULL REFERENCES rooms(number),staff_id INTEGER NOT NULL REFERENCES staff(id),category TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(work_date,room));
  CREATE INDEX IF NOT EXISTS ix_records_date ON records(work_date);CREATE INDEX IF NOT EXISTS ix_records_staff ON records(staff_id,work_date);
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,staff_id INTEGER,expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS edit_sessions(token_hash TEXT PRIMARY KEY,staff_id INTEGER NOT NULL,work_date TEXT NOT NULL,expires_at TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS checker_totals(work_date TEXT PRIMARY KEY,out_s INTEGER NOT NULL DEFAULT 0,out_d INTEGER NOT NULL DEFAULT 0,out_t INTEGER NOT NULL DEFAULT 0,out_tr INTEGER NOT NULL DEFAULT 0,ky INTEGER NOT NULL DEFAULT 0,stay INTEGER NOT NULL DEFAULT 0,eco INTEGER NOT NULL DEFAULT 0,higaeri INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL);''')
  if not c.execute('SELECT 1 FROM staff LIMIT 1').fetchone():c.executemany('INSERT INTO staff(name) VALUES(?)',[(x,) for x in STAFF])
  if not c.execute('SELECT 1 FROM rooms LIMIT 1').fetchone():c.executemany('INSERT INTO rooms(number,type) VALUES(?,?)',ROOMS.items())

def dump(rows):return [dict(x) for x in rows]
def log(c,actor,action,details):c.execute('INSERT INTO audit(at,actor,action,details) VALUES(?,?,?,?)',(now(),actor,action,json.dumps(details,ensure_ascii=False)))
def tokenhash(t):return hashlib.sha256(t.encode()).hexdigest()
def expiry(hours=12):return (datetime.now(JST)+timedelta(hours=hours)).isoformat(timespec='seconds')
def valid_date(s):
 try:return date.fromisoformat(s).isoformat()==s
 except:return False
class Error(Exception):
 def __init__(self,message,status=400):self.message=message;self.status=status

def get_role(c,token):
 if not token:return None
 row=c.execute('SELECT role FROM sessions WHERE token_hash=? AND expires_at>?',(tokenhash(token),now())).fetchone()
 return row['role'] if row else None

def reports(c,start,end,staff=None):
 sql='''SELECT r.id,r.work_date,r.room,rm.type,r.staff_id,s.name staff,r.category,r.created_at,r.updated_at FROM records r JOIN staff s ON s.id=r.staff_id JOIN rooms rm ON rm.number=r.room WHERE r.work_date BETWEEN ? AND ?'''
 args=[start,end]
 if staff:sql+=' AND r.staff_id=?';args.append(int(staff))
 sql+=' ORDER BY r.work_date DESC,r.room'
 return dump(c.execute(sql,args))

def serve_api(method,path,query,data,token):
 with conn() as c:
  role=get_role(c,token)
  if path=='/api/config' and method=='GET':return {'today':today(),'staff':dump(c.execute('SELECT id,name FROM staff WHERE active=1 ORDER BY id')),'rooms':dump(c.execute('SELECT number,type FROM rooms WHERE active=1 ORDER BY number')),'role':role}
  if path=='/api/login' and method=='POST':
   r=data.get('role');pw=data.get('password','')
   expected=ADMIN_PASSWORD if r=='admin' else CHECKER_PASSWORD if r=='checker' else None
   if not expected or not isinstance(pw,str) or not hmac.compare_digest(pw,expected):raise Error('パスワードが違います',401)
   t=secrets.token_urlsafe(36);c.execute('INSERT INTO sessions VALUES(?,?,?,?)',(tokenhash(t),r,None,expiry()))
   return {'role':r,'_cookie':t}
  if path=='/api/logout' and method=='POST':
   if token:c.execute('DELETE FROM sessions WHERE token_hash=?',(tokenhash(token),))
   return {'ok':True,'_clear_cookie':True}
  if path=='/api/status' and method=='GET':
   d=query.get('date',[today()])[0]
   if not valid_date(d):raise Error('日付が不正です')
   return {'records':dump(c.execute('SELECT r.room,r.staff_id,s.name staff,r.category FROM records r JOIN staff s ON s.id=r.staff_id WHERE r.work_date=? ORDER BY r.room',(d,)))}
  if path=='/api/submit' and method=='POST':
   d=data.get('date');sid=data.get('staff_id');items=data.get('items');edit=data.get('edit_token')
   if not valid_date(d) or d>today() or not isinstance(items,list) or len(items)>53:raise Error('日付または入力内容が不正です')
   if not isinstance(sid,int):raise Error('スタッフを選択してください')
   if not c.execute('SELECT 1 FROM staff WHERE id=? AND active=1',(sid,)).fetchone():raise Error('スタッフが見つかりません')
   rooms=[]
   for x in items:
    if not isinstance(x,dict) or type(x.get('room'))!=int or x.get('category') not in CATS:raise Error('部屋または清掃区分が不正です')
    rooms.append(x['room'])
   if len(set(rooms))!=len(rooms):raise Error('同じ部屋が重複しています')
   if rooms and c.execute('SELECT COUNT(*) n FROM rooms WHERE active=1 AND number IN (%s)'%(','.join('?'*len(rooms))),rooms).fetchone()['n']!=len(rooms):raise Error('未登録の部屋があります')
   c.execute('BEGIN IMMEDIATE')
   try:
    editing=None
    if isinstance(edit,str):editing=c.execute('SELECT * FROM edit_sessions WHERE token_hash=? AND staff_id=? AND work_date=? AND closed=0 AND expires_at>?',(tokenhash(edit),sid,d,now())).fetchone()
    if edit and not editing:raise Error('修正受付は終了しました。管理者に依頼してください',403)
    existing=dump(c.execute('SELECT room,category FROM records WHERE work_date=? AND staff_id=?',(d,sid)))
    if existing and not editing:raise Error('既に登録済みです。管理者に修正を依頼してください',409)
    conflict=c.execute('SELECT room FROM records WHERE work_date=? AND staff_id<>? AND room IN (%s)'%(','.join('?'*len(rooms)) if rooms else 'NULL'),[d,sid,*rooms]).fetchone()
    if conflict:raise Error(f'{conflict["room"]}号室は他のスタッフが登録済みです',409)
    if editing:c.execute('DELETE FROM records WHERE work_date=? AND staff_id=?',(d,sid))
    stamp=now()
    for x in items:c.execute('INSERT INTO records(work_date,room,staff_id,category,created_at,updated_at) VALUES(?,?,?,?,?,?)',(d,x['room'],sid,x['category'],stamp,stamp))
    if not editing:
     edit=secrets.token_urlsafe(32);c.execute('INSERT INTO edit_sessions VALUES(?,?,?,?,0)',(tokenhash(edit),sid,d,expiry(2)))
    log(c,f'staff:{sid}','submit' if not editing else 'immediate_edit',{'date':d,'before':existing,'after':items})
    c.commit()
   except: c.rollback();raise
   return {'ok':True,'edit_token':edit,'items':items,'count':len(items)}
  if path=='/api/close-edit' and method=='POST':
   t=data.get('edit_token','')
   if isinstance(t,str) and t:c.execute('UPDATE edit_sessions SET closed=1 WHERE token_hash=?',(tokenhash(t),))
   return {'ok':True}
  if path=='/api/my-records' and method=='GET':
   d=query.get('date',[today()])[0];sid=query.get('staff_id',[''])[0]
   if not valid_date(d) or not str(sid).isdigit():raise Error('日付・スタッフが不正です')
   return {'records':dump(c.execute('SELECT r.room,rm.type,r.category FROM records r JOIN rooms rm ON rm.number=r.room WHERE work_date=? AND staff_id=? ORDER BY r.room',(d,int(sid))))}
  if path=='/api/checker' and method=='GET':
   if role not in ('checker','admin'):raise Error('権限がありません',403)
   d=query.get('date',[today()])[0]
   if not valid_date(d):raise Error('日付が不正です')
   row=c.execute('SELECT * FROM checker_totals WHERE work_date=?',(d,)).fetchone()
   records=reports(c,d,d)
   return {'totals':dict(row) if row else None,'records':records}
  if path=='/api/checker' and method=='POST':
   if role not in ('checker','admin'):raise Error('権限がありません',403)
   d=data.get('date');fields=['out_s','out_d','out_t','out_tr','ky','stay','eco','higaeri']
   if not valid_date(d) or d>today() or any(type(data.get(k))!=int or not 0<=data[k]<=999 for k in fields):raise Error('入力内容が不正です')
   vals=[data[k] for k in fields]
   c.execute('INSERT INTO checker_totals VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(work_date) DO UPDATE SET '+','.join(f'{k}=excluded.{k}' for k in fields)+',updated_at=excluded.updated_at',[d,*vals,now()])
   log(c,role,'checker_totals',{'date':d,**{k:data[k] for k in fields}})
   return {'ok':True}
  if path.startswith('/api/admin/'):
   if role!='admin':raise Error('管理者ログインが必要です',403)
   if path=='/api/admin/staff' and method=='GET':return {'staff':dump(c.execute('SELECT * FROM staff ORDER BY id'))}
   if path=='/api/admin/staff' and method=='POST':
    name=str(data.get('name','')).strip().upper()
    if not 1<=len(name)<=80:raise Error('氏名を入力してください')
    if data.get('id'):
     sid=int(data['id']);active=int(bool(data.get('active',True)))
     if not c.execute('SELECT 1 FROM staff WHERE id=?',(sid,)).fetchone():raise Error('スタッフが見つかりません',404)
     c.execute('UPDATE staff SET name=?,active=? WHERE id=?',(name,active,sid));log(c,'admin','staff_update',{'id':sid,'name':name,'active':active})
    else:
     sid=c.execute('INSERT INTO staff(name) VALUES(?)',(name,)).lastrowid;log(c,'admin','staff_add',{'id':sid,'name':name})
    return {'ok':True}
   if path=='/api/admin/rooms' and method=='GET':return {'rooms':dump(c.execute('SELECT * FROM rooms ORDER BY number'))}
   if path=='/api/admin/rooms' and method=='POST':
    num=data.get('number');typ=data.get('type');active=int(bool(data.get('active',True)))
    if type(num)!=int or not 200<=num<=699 or num//100 not in range(2,7) or typ not in ('S','D','T','TR'):raise Error('部屋情報が不正です')
    c.execute('INSERT INTO rooms(number,type,active) VALUES(?,?,?) ON CONFLICT(number) DO UPDATE SET type=excluded.type,active=excluded.active',(num,typ,active));log(c,'admin','room_update',{'room':num,'type':typ,'active':active});return {'ok':True}
   if path=='/api/admin/report' and method=='GET':
    start=query.get('start',[today()])[0];end=query.get('end',[today()])[0];staff=query.get('staff',[''])[0]
    if not valid_date(start) or not valid_date(end) or start>end or (date.fromisoformat(end)-date.fromisoformat(start)).days>366:raise Error('検索期間は367日以内にしてください')
    return {'records':reports(c,start,end,staff or None),'checker':dump(c.execute('SELECT * FROM checker_totals WHERE work_date BETWEEN ? AND ? ORDER BY work_date',(start,end)))}
   if path=='/api/admin/record' and method=='POST':
    d=data.get('date');room=data.get('room');sid=data.get('staff_id');cat=data.get('category')
    if not valid_date(d) or type(room)!=int or type(sid)!=int or cat not in CATS:raise Error('入力が不正です')
    if not c.execute('SELECT 1 FROM rooms WHERE number=?',(room,)).fetchone() or not c.execute('SELECT 1 FROM staff WHERE id=?',(sid,)).fetchone():raise Error('部屋またはスタッフが見つかりません')
    before=c.execute('SELECT * FROM records WHERE work_date=? AND room=?',(d,room)).fetchone()
    c.execute('INSERT INTO records(work_date,room,staff_id,category,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(work_date,room) DO UPDATE SET staff_id=excluded.staff_id,category=excluded.category,updated_at=excluded.updated_at',(d,room,sid,cat,now(),now()))
    log(c,'admin','record_upsert',{'before':dict(before) if before else None,'after':data});return {'ok':True}
   if path=='/api/admin/record' and method=='DELETE':
    d=data.get('date');room=data.get('room')
    if not valid_date(d) or type(room)!=int:raise Error('入力が不正です')
    before=c.execute('SELECT * FROM records WHERE work_date=? AND room=?',(d,room)).fetchone()
    c.execute('DELETE FROM records WHERE work_date=? AND room=?',(d,room));log(c,'admin','record_delete',{'before':dict(before) if before else None});return {'ok':True}
   if path=='/api/admin/audit' and method=='GET':return {'audit':dump(c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 200'))}
   if path=='/api/admin/export' and method=='GET':
    start=query.get('start',[today()])[0];end=query.get('end',[today()])[0]
    if not valid_date(start) or not valid_date(end) or start>end or (date.fromisoformat(end)-date.fromisoformat(start)).days>366:raise Error('日付が不正です')
    rows=reports(c,start,end,query.get('staff',[''])[0] or None)
    out=io.StringIO();writer=csv.writer(out);writer.writerow(['清掃日','部屋番号','部屋タイプ','スタッフ','清掃区分','登録日時','更新日時'])
    for r in rows:writer.writerow([r[k] for k in ('work_date','room','type','staff','category','created_at','updated_at')])
    return {'_csv':'\ufeff'+out.getvalue()}
  raise Error('ページが見つかりません',404)

class Handler(BaseHTTPRequestHandler):
 def log_message(self,fmt,*args):print('%s %s'%(self.address_string(),fmt%args))
 def send(self,status,obj,headers=None):
  body=json.dumps(obj,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
  for k,v in (headers or {}).items():self.send_header(k,v)
  self.end_headers();self.wfile.write(body)
 def run(self):
  parsed=urlparse(self.path);path=parsed.path
  if not path.startswith('/api/'):
   p=BASE/'static'/('index.html' if path=='/' else path.lstrip('/'))
   if not p.is_file() or not p.resolve().is_relative_to((BASE/'static').resolve()):self.send_error(404);return
   content=p.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(p.name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(content)));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','no-cache');self.end_headers();self.wfile.write(content);return
  try:
   data={}
   if self.command in ('POST','DELETE'):
    origin=self.headers.get('Origin')
    if origin:
     host=self.headers.get('Host','');allowed=('http://'+host,'https://'+host)
     if origin not in allowed:raise Error('不正な送信元です',403)
    if self.headers.get('Content-Type','').split(';')[0].strip()!='application/json':raise Error('JSON形式で送信してください',415)
    n=int(self.headers.get('Content-Length','0'))
    if n>65536:raise Error('入力が大きすぎます',413)
    data=json.loads(self.rfile.read(n) or b'{}')
    if not isinstance(data,dict):raise Error('入力形式が不正です')
   cookie=SimpleCookie()
   try:cookie.load(self.headers.get('Cookie',''))
   except:pass
   t=cookie['apa_session'].value if 'apa_session' in cookie else None
   result=serve_api(self.command,path,parse_qs(parsed.query),data,t)
   headers={}
   if '_cookie' in result:headers['Set-Cookie']='apa_session='+result.pop('_cookie')+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+('; Secure' if self.headers.get('X-Forwarded-Proto')=='https' else '')
   if result.pop('_clear_cookie',False):headers['Set-Cookie']='apa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
   if '_csv' in result:
    content=result['_csv'].encode('utf-8');self.send_response(200);self.send_header('Content-Type','text/csv; charset=utf-8');self.send_header('Content-Disposition','attachment; filename="cleaning-report.csv"');self.send_header('Content-Length',str(len(content)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(content);return
   self.send(200,result,headers)
  except Error as e:self.send(e.status,{'error':e.message})
  except (ValueError,TypeError,sqlite3.IntegrityError) as e:self.send(400,{'error':'入力を確認してください: '+str(e)[:120]})
  except Exception as e:print('SERVER ERROR',repr(e));self.send(500,{'error':'サーバーエラーが発生しました'})
 def do_GET(self):self.run()
 def do_POST(self):self.run()
 def do_DELETE(self):self.run()

if __name__=='__main__':
 if not ADMIN_PASSWORD or not CHECKER_PASSWORD:raise SystemExit('APA_ADMIN_PASSWORD と APA_CHECKER_PASSWORD を環境変数で設定してください')
 if ADMIN_PASSWORD==CHECKER_PASSWORD:raise SystemExit('管理者とCHECKERのパスワードは別にしてください')
 init();print(f'APA Cleaning System listening on http://0.0.0.0:{PORT}');ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
