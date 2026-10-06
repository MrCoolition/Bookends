import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID } from "../lib/admin/local";
import { applySpreadsheetImport, planSpreadsheetImport, readSpreadsheetFile, SPREADSHEET_HEADERS, type SpreadsheetWorkbook, type SpreadsheetSheetName, type SpreadsheetCell } from "../lib/admin/spreadsheet";

function sheet(name: SpreadsheetSheetName, records: SpreadsheetCell[][], headers: string[] = [...SPREADSHEET_HEADERS[name]]) { return { name, rows: [[name],["Instructions"],[],headers,...records] }; }
function example(): SpreadsheetWorkbook { return { sheets: [sheet("Missions",[["Analytics launch","northstar"]]),sheet("People",[["Alex Morgan","Data",""]]),sheet("Clients",[["northstar","Northstar","Jamie","jamie@example.test","Welcome notes"]]),sheet("HOMEs",[["Data","Data practice","Analysis and engineering"]])] }; }
function imported() { const store=createLocalAdminStore(); return applySpreadsheetImport(store,planSpreadsheetImport(store,example())); }
function code(expected: string) { return (error:unknown)=>!!error&&typeof error==="object"&&"code" in error&&error.code===expected; }

test("spreadsheet preview resolves parents in any sheet order and commits a whole batch once", () => {
  const store=createLocalAdminStore(), before=structuredClone(store), plan=planSpreadsheetImport(store,example());
  assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.counts,{adds:4,updates:0,skips:0});assert.deepEqual(store,before);
  const next=applySpreadsheetImport(store,plan);
  assert.deepEqual(store,before);assert.equal(next.revision,store.revision+1);
  assert.equal(next.data.resources[0].home,"Data");assert.equal(next.data.resources[0].ownerId,LOCAL_ADMIN_OWNER_ID);
  assert.equal(next.data.missions[0].clientId,next.data.clients[0].id);
  const repeated=planSpreadsheetImport(next,example());
  assert.deepEqual(repeated.counts,{adds:0,updates:0,skips:4});
  assert.deepEqual(applySpreadsheetImport(next,repeated),next);
  assert.throws(()=>applySpreadsheetImport(next,plan),code("conflict"));
});

test("updated fields are reviewable, optional blanks clear values, omitted columns preserve them, and IDs survive", () => {
  const store=imported(), original=store.data.clients[0];
  const workbook:SpreadsheetWorkbook={sheets:[sheet("Clients",[["northstar","Northstar studio","","",""]])]};
  const plan=planSpreadsheetImport(store,workbook);
  assert.deepEqual(plan.counts,{adds:0,updates:1,skips:0});
  assert.deepEqual(plan.changes[0].fields?.find(field=>field.field==="Client name"),{field:"Client name",before:"Northstar",after:"Northstar studio"});
  assert.deepEqual(plan.changes[0].fields?.find(field=>field.field==="Notes"),{field:"Notes",before:"Welcome notes",after:""});
  const next=applySpreadsheetImport(store,plan);
  assert.equal(next.data.clients[0].id,original.id);assert.equal(next.data.clients[0].revision,2);assert.equal(next.data.clients[0].notes,"");
  assert.equal(next.data.missions[0].clientId,original.id);
  const omitted=planSpreadsheetImport(store,{sheets:[sheet("Clients",[["northstar","Only name changed"]],["Client code","Client name"])]});
  assert.equal(applySpreadsheetImport(store,omitted).data.clients[0].notes,"Welcome notes");
});

test("owner names resolve existing active local members and updates show names rather than IDs", () => {
  let store=imported();
  store=applyLocalAdminCommand(store,{type:"create_local_member",name:"Jamie Owner",role:"mission_owner",homeScope:null,resourceId:null,grants:[]});
  const workbook:SpreadsheetWorkbook={sheets:[sheet("People",[["Alex Morgan","Data","Jamie Owner"]])]};
  const plan=planSpreadsheetImport(store,workbook);
  assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.changes[0].fields,[{field:"Owner name",before:"Workspace owner",after:"Jamie Owner"}]);
  const next=applySpreadsheetImport(store,plan);assert.equal(next.data.resources[0].id,store.data.resources[0].id);
  assert.equal(next.data.resources[0].ownerId,store.data.members.find(member=>member.name==="Jamie Owner")!.id);
  store=applyLocalAdminCommand(store,{type:"create_local_member",name:"Jamie Owner",role:"mission_owner",homeScope:null,resourceId:null,grants:[]});
  assert.ok(planSpreadsheetImport(store,workbook).errors.some(error=>error.field==="Owner name"&&error.message.includes("exactly one")));
});

test("duplicate and archived matches, unknown columns and invalid references block the entire import", () => {
  let store=imported();const before=structuredClone(store);
  const invalid:SpreadsheetWorkbook={sheets:[
    sheet("HOMEs",[["AI","AI practice","valid"],["AI","Duplicate AI","duplicate"]]),
    sheet("People",[["New teammate","Missing HOME",""]]),
    sheet("Clients",[["new","New client","bad-email","Keep me"]],["Client code","Client name","Contact email","Unexpected data"]),
  ]};
  const plan=planSpreadsheetImport(store,invalid);
  assert.ok(plan.errors.some(error=>error.sheet==="HOMEs"&&error.row===6));
  assert.ok(plan.errors.some(error=>error.sheet==="People"&&error.field==="HOME code"));
  assert.ok(plan.errors.some(error=>error.field==="Unexpected data"));
  assert.throws(()=>applySpreadsheetImport(store,plan),code("invalid_import"));assert.deepEqual(store,before);
  const invalidEmail=planSpreadsheetImport(store,{sheets:[sheet("Clients",[["new","New client","","bad-email",""]])]});
  assert.ok(invalidEmail.errors.some(error=>error.row===5&&error.field==="Contact email"&&error.message==="Enter a valid email address or leave this cell blank."));
  const home=store.data.homes[0], person=store.data.resources[0];
  store=applyLocalAdminCommand(store,{type:"set_resource_active",id:person.id,expectedRevision:1,active:false});
  store=applyLocalAdminCommand(store,{type:"set_home_active",id:home.id,expectedRevision:1,active:false});
  assert.ok(planSpreadsheetImport(store,{sheets:[sheet("HOMEs",[["Data","Data practice",""]])]}).errors.some(error=>error.message.includes("archived")));
});

test("existing ambiguous person keys and changed baselines cannot be silently overwritten", () => {
  let store=imported();
  store=applyLocalAdminCommand(store,{type:"save_resource",name:"Alex Morgan",home:"Data",ownerId:LOCAL_ADMIN_OWNER_ID});
  const plan=planSpreadsheetImport(store,{sheets:[sheet("People",[["Alex Morgan","Data",""]])]});
  assert.ok(plan.errors.some(error=>error.message.includes("More than one existing")));
  const clean=imported(), reviewed=planSpreadsheetImport(clean,{sheets:[sheet("Clients",[["northstar","Changed name","","",""]])]});
  const edited=structuredClone(clean);edited.data.clients[0].notes="Changed elsewhere without a revision";
  assert.throws(()=>applySpreadsheetImport(edited,reviewed),code("conflict"));
});

test("blank rows are ignored, formulas are diagnosed, and sheet/record limits are explicit", () => {
  const store=createLocalAdminStore();
  const blank=sheet("HOMEs",Array.from({length:1000},()=>[null,null,null]));
  assert.deepEqual(planSpreadsheetImport(store,{sheets:[blank]}).counts,{adds:0,updates:0,skips:0});
  const formula=planSpreadsheetImport(store,{sheets:[sheet("HOMEs",[[{formula:'"Data"'},"Data practice",""]])]});
  assert.ok(formula.errors.some(error=>error.row===5&&error.field==="HOME code"&&error.message.includes("formula")));
  blank.rows.push(["Late","Too late",""]);
  assert.ok(planSpreadsheetImport(store,{sheets:[blank]}).errors.some(error=>error.row===1005));
  const full=imported();
  full.data.resources=Array.from({length:1000},(_,index)=>({id:crypto.randomUUID(),name:`Person ${index}`,home:"Data",ownerId:LOCAL_ADMIN_OWNER_ID,active:true,revision:1}));
  assert.ok(planSpreadsheetImport(full,{sheets:[sheet("People",[["One too many","Data",""]])]}).errors.some(error=>error.message.includes("1,000-record")));
});

const templateUrl=new URL("../public/templates/BOOKENDS_Seed_Template.xlsx",import.meta.url);
async function templateFile() { return new File([new Uint8Array(await readFile(templateUrl))],"BOOKENDS_Seed_Template.xlsx"); }
test("actual blank Excel template parses quickly without importing its 1000 formatted empty rows", async () => {
  const workbook=await readSpreadsheetFile(await templateFile());
  assert.deepEqual(workbook.sheets.map(sheet=>sheet.name),["HOMEs","Clients","People","Missions"]);
  const plan=planSpreadsheetImport(createLocalAdminStore(),workbook);
  assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.counts,{adds:0,updates:0,skips:0});
});

test("actual XLSX formula metadata rejects cached values and keeps exact cell diagnostics", async () => {
  const entries=unzipSync(new Uint8Array(await readFile(templateUrl)));
  const name="xl/worksheets/sheet2.xml";
  let xml=strFromU8(entries[name]);
  // Test fixtures alter only in-memory OOXML; the delivered template stays untouched.
  const prefix=xml.includes("<x:worksheet")?"x:":"";
  xml=xml.replace(new RegExp(`<${prefix}c r="A5"[^>]*\\/>`),`<${prefix}c r="A5"><${prefix}f>2+2</${prefix}f><${prefix}v>4</${prefix}v></${prefix}c>`);
  xml=xml.replace(new RegExp(`<${prefix}c r="B5"[^>]*\\/>`),`<${prefix}c r="B5" t="str"><${prefix}v>Formula HOME</${prefix}v></${prefix}c>`);
  entries[name]=strToU8(xml);
  const workbook=await readSpreadsheetFile(new File([new Uint8Array(zipSync(entries))],"formula.xlsx"));
  const plan=planSpreadsheetImport(createLocalAdminStore(),workbook);
  assert.ok(plan.errors.some(error=>error.sheet==="HOMEs"&&error.row===5&&error.field==="HOME code"&&error.message.includes("formula")));
  assert.equal(plan.counts.adds,0);
});

test("empty Excel column widths outside the data area remain importable within a bounded formatting budget", async () => {
  const template=unzipSync(new Uint8Array(await readFile(templateUrl)));
  for(const [min,max] of [[65,65],[1,16_384]]) {
    const entries={...template},name="xl/worksheets/sheet3.xml";
    let xml=strFromU8(entries[name]);
    const prefix=xml.includes("<x:worksheet")?"x:":"";
    xml=xml.replace(new RegExp(`<${prefix}cols>[\\s\\S]*?</${prefix}cols>`),`<${prefix}cols><${prefix}col min="${min}" max="${max}" width="12" customWidth="1" /></${prefix}cols>`);
    for(const [address,text] of [["A5","formatted-client"],["B5","Formatted client"]]) xml=xml.replace(new RegExp(`<${prefix}c r="${address}"[^>]*\\/>`),`<${prefix}c r="${address}" t="str"><${prefix}v>${text}</${prefix}v></${prefix}c>`);
    entries[name]=strToU8(xml);
    const workbook=await readSpreadsheetFile(new File([new Uint8Array(zipSync(entries))],"ordinary-formatting.xlsx"));
    const plan=planSpreadsheetImport(createLocalAdminStore(),workbook);
    assert.deepEqual(plan.errors,[]);assert.equal(plan.counts.adds,1);
  }
});

test("ordinary Excel email hyperlinks import only their displayed text without following the link", async () => {
  const entries=unzipSync(new Uint8Array(await readFile(templateUrl)));
  const name="xl/worksheets/sheet3.xml";
  let xml=strFromU8(entries[name]);
  const prefix=xml.includes("<x:worksheet")?"x:":"";
  for(const [address,text] of [["A5","contact-client"],["B5","Contact client"],["D5","contact@example.test"]]) xml=xml.replace(new RegExp(`<${prefix}c r="${address}"[^>]*\\/>`),`<${prefix}c r="${address}" t="str"><${prefix}v>${text}</${prefix}v></${prefix}c>`);
  if(!xml.includes("xmlns:r="))xml=xml.replace(`<${prefix}worksheet`, `<${prefix}worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`);
  xml=xml.replace(`</${prefix}worksheet>`,`<${prefix}hyperlinks><${prefix}hyperlink ref="D5" r:id="rIdEmailTest" /></${prefix}hyperlinks></${prefix}worksheet>`);
  entries[name]=strToU8(xml);
  const relationship='<Relationship Id="rIdEmailTest" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:contact@example.test" TargetMode="External" />';
  const rels="xl/worksheets/_rels/sheet3.xml.rels";
  entries[rels]=strToU8(entries[rels]?strFromU8(entries[rels]).replace('</Relationships>',relationship+'</Relationships>'):`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`);
  const workbook=await readSpreadsheetFile(new File([new Uint8Array(zipSync(entries))],"linked-email.xlsx"));
  const store=createLocalAdminStore(),plan=planSpreadsheetImport(store,workbook);
  assert.deepEqual(plan.errors,[]);assert.equal(plan.counts.adds,1);
  assert.equal(applySpreadsheetImport(store,plan).data.clients[0].contactEmail,"contact@example.test");
});

test("file adapter rejects other file types, corrupt archives, input size and expansion bombs", async () => {
  await assert.rejects(readSpreadsheetFile(new File(["text"],"people.csv")),code("invalid_file"));
  await assert.rejects(readSpreadsheetFile(new File(["text"],"corrupt.xlsx")),code("invalid_file"));
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(5*1024*1024+1)],"large.xlsx")),code("too_large"));
  const compressed=zipSync({"oversized.xml":new Uint8Array(20*1024*1024+1)});
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(compressed)],"expanded.xlsx")),code("too_large"));
  const falsified=compressed.slice(), view=new DataView(falsified.buffer);
  for(let offset=0;offset+28<falsified.length;offset++) {
    const signature=view.getUint32(offset,true);
    if(signature===0x04034b50)view.setUint32(offset+22,100,true);
    if(signature===0x02014b50)view.setUint32(offset+24,100,true);
  }
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(falsified)],"falsified-expansion.xlsx")),code("too_large"));
  for(const xml of ['<worksheet><sheetData><row r = "1048576"><c r = "XFD1048576"><v>1</v></c></row></sheetData></worksheet>','<worksheet><cols><col min = "1" max = "2147483647" /></cols></worksheet>','<worksheet><mergeCells><mergeCell ref = "A1:XFD1048576" /></mergeCells></worksheet>']) {
    const extreme=zipSync({"xl/worksheets/sheet1.xml":strToU8(xml)});
    await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(extreme)],"extreme-coordinate.xlsx")),code("too_large"));
  }
  const largeMerge=strToU8('<worksheet><mergeCells><mergeCell ref="A1:BL1004" /></mergeCells></worksheet>');
  const manyMerged=zipSync({"xl/worksheets/sheet1.xml":largeMerge,"xl/worksheets/sheet2.xml":largeMerge});
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(manyMerged)],"merged-area-limit.xlsx")),code("too_large"));
  const normalizedPath=zipSync({"xl/worksheets/../worksheets/sheet1.xml":strToU8('<worksheet/>')});
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(normalizedPath)],"noncanonical-path.xlsx")),code("invalid_file"));
  const columnFormatting=strToU8('<worksheet><cols><col min="1" max="16384" width="12" /></cols></worksheet>');
  const excessiveFormatting=zipSync(Object.fromEntries(Array.from({length:7},(_,index)=>[`xl/worksheets/sheet${index+1}.xml`,columnFormatting])));
  await assert.rejects(readSpreadsheetFile(new File([new Uint8Array(excessiveFormatting)],"formatting-budget.xlsx")),code("too_large"));
});
