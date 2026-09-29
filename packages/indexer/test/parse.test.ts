import { describe, it, expect } from 'vitest';
import { parseSource } from '../src/index.js';

const samples:Record<string,{source:string;defs:string[];refs:string[];imports:string[]}>={
  'a.ts':{source:"import {check} from './auth';\nimport type {User} from '@app/models';\nexport interface Opts { user: User }\nexport type Id = string;\nexport enum Mode { A }\nexport const handler = async (o: Opts) => check(o.user);\nexport const LIMIT = 5;\nexport class Service extends Base {\n  run() { return this.repo.save(new Item()) }\n}\nexport function helper() { return handler({} as Opts) }\n",defs:['Opts','Id','Mode','handler','LIMIT','Service','run','helper'],refs:['check','User','save','Item','handler','Opts'],imports:['./auth','@app/models']},
  'b.tsx':{source:"import Button from './Button';\nexport function Page() { return <Button onClick={() => track('x')} /> }\n",defs:['Page'],refs:['Button','track'],imports:['./Button']},
  'c.js':{source:"const db = require('./db');\nclass Repo { find(id) { return db.query(id) } }\nmodule.exports = { Repo };\n",defs:['db','Repo','find'],refs:['query','require'],imports:['./db']},
  'd.py':{source:"import os\nfrom .models import User\nfrom app.auth import check\nLIMIT = 3\nclass Service(Base):\n    def run(self, u: User):\n        return check(u)\n\ndef helper():\n    return Service().run(None)\n",defs:['LIMIT','Service','run','helper'],refs:['Base','check','Service','run'],imports:['os','.models','app.auth']},
  'e.go':{source:"package svc\nimport (\n  \"fmt\"\n  \"example.com/app/store\"\n)\ntype Server struct{ db store.DB }\nfunc (s *Server) Get(id string) error { return s.db.Load(id) }\nfunc New() *Server { fmt.Println(\"x\"); return &Server{} }\n",defs:['Server','Get','New'],refs:['Load','Println','DB'],imports:['fmt','example.com/app/store']},
  'F.java':{source:"package app;\nimport com.acme.store.Repo;\npublic class Service implements Api {\n  private Repo repo;\n  public Service(Repo r) { this.repo = r; }\n  public User find(String id) { return repo.load(id); }\n}\n",defs:['Service','find'],refs:['Repo','load','User','Api'],imports:['com.acme.store.Repo']},
  'g.rs':{source:"use crate::store::Repo;\nmod util;\npub struct Service { repo: Repo }\npub trait Api { fn get(&self) -> u32; }\nimpl Service {\n  pub fn find(&self, id: u32) -> Option<u32> { self.repo.load(id); util::check(id); println!(\"x\"); None }\n}\n",defs:['Service','Api','get','find'],refs:['Repo','load','check','println'],imports:['crate::store::Repo','util']},
  'h.rb':{source:"require_relative 'store'\nmodule Billing\n  class Invoice < Base\n    def total(items)\n      items.sum { |i| price(i) }\n    end\n    def self.build; Store.new; end\n  end\nend\n",defs:['Billing','Invoice','total','build'],refs:['price','Store','Base'],imports:['store']},
  'i.cs':{source:"using App.Store;\nnamespace App { public class Service : IApi {\n  public Service() {}\n  public User Find(string id) { return repo.Load(id); }\n  void X() { var r = new Repo(); Helper(); }\n} }\n",defs:['Service','Find','X'],refs:['Load','Repo','Helper','IApi'],imports:['App.Store']},
  'j.php':{source:"<?php\nuse App\\Store\\Repo;\nclass Service { public function find($id) { return $this->repo->load($id); } }\nfunction helper() { return new Service(); }\n",defs:['Service','find','helper'],refs:['load','Service'],imports:['App\\Store\\Repo']},
  'k.cpp':{source:"#include \"store.h\"\n#include <vector>\nclass Service { public: int find(int id); };\nint Service::find(int id) { return load(id); }\nint helper() { Service s; return s.find(1); }\n",defs:['Service','find','helper'],refs:['load','find','Service'],imports:['store.h','vector']},
};

describe('tree-sitter extraction',()=>{
  for(const [path,s] of Object.entries(samples))it(`extracts ${path}`,async()=>{
    const parsed=(await parseSource(path,s.source))!;expect(parsed).toBeDefined();
    const defs=parsed.defs.map(d=>d.name),refs=parsed.refs.map(r=>r.name);
    for(const d of s.defs)expect(defs,`${path} def ${d}`).toContain(d);
    for(const r of s.refs)expect(refs,`${path} ref ${r}`).toContain(r);
    expect(parsed.imports.sort()).toEqual([...s.imports].sort());
  });
  it('records definition ranges and method kinds',async()=>{const p=(await parseSource('m.py','class A:\n    def run(self):\n        x = 1\n        return x\n'))!;expect(p.defs.find(d=>d.name==='run')).toMatchObject({kind:'method',startLine:2,endLine:4});expect(p.defs.find(d=>d.name==='A')).toMatchObject({kind:'class',startLine:1,endLine:4})});
  it('ignores unsupported files',async()=>expect(await parseSource('README.md','# hi')).toBeUndefined());
});
