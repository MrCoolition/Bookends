import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyLocalAdminCommand, createLocalAdminStore, LOCAL_ADMIN_OWNER_ID } from "../lib/admin/local";
import { findRoleMatches } from "../lib/admin/engagement";
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
  assert.deepEqual(workbook.sheets.map(sheet=>sheet.name),["HOMEs","Clients","People","Missions","Engagements","Engagement roles","Roles","Skills"]);
  const plan=planSpreadsheetImport(createLocalAdminStore(),workbook);
  assert.deepEqual(plan.errors,[]);assert.deepEqual(plan.counts,{adds:0,updates:0,skips:0});
});

function engagementWorkbook(): SpreadsheetWorkbook {
  return { sheets: [sheet("Engagement roles", [
    ["Application build", "ACORN", "Data engineer", 2, 100, "SQL; Python", "Build and operate data pipelines", "", ""],
    ["Application build", "ACORN", "Full stack developer", 3, 100, "React; TypeScript", "Build and test the application", "", ""],
    ["Application build", "ACORN", "BA / PM", 1, "50%", "Agile; Requirements; Testing", "Run boards and agile ceremonies; maintain requirements; light testing", "2027-02-01", "2027-06-30"],
  ]), sheet("Engagements", [["Application build", "ACORN", "SOW-2027-001", "signed", "2026-12-18", "2027-01-01", "2027-06-30", "Launch a customer application"]]), sheet("Clients", [["ACORN", "Acorn Studio", "", "", ""]])] };
}
test("SOW import links a months-long engagement and role demand regardless of sheet order", () => {
  const store = createLocalAdminStore(), before = structuredClone(store), plan = planSpreadsheetImport(store, engagementWorkbook());
  assert.deepEqual(plan.errors, []); assert.deepEqual(plan.counts, { adds: 5, updates: 0, skips: 0 });
  const next = applySpreadsheetImport(store, plan), engagement = next.data.missions[0].engagement!;
  assert.deepEqual(store, before); assert.equal(engagement.roles.length, 3);
  assert.equal(engagement.roles[0].start, "2027-01-01"); assert.equal(engagement.roles[0].end, "2027-06-30");
  assert.equal(engagement.roles[2].headcount, 1); assert.equal(engagement.roles[2].allocationPercent, 50);
  assert.deepEqual(engagement.roles[0].skills, ["SQL", "Python"]);
  const repeated = planSpreadsheetImport(next, engagementWorkbook());
  assert.deepEqual(repeated.errors, []); assert.deepEqual(repeated.counts, { adds: 0, updates: 0, skips: 5 });
  assert.deepEqual(applySpreadsheetImport(next, repeated), next);
});

test("role updates preserve stable IDs, unmentioned roles, omitted columns and legacy Missions compatibility", () => {
  const empty = createLocalAdminStore(), store = applySpreadsheetImport(empty, planSpreadsheetImport(empty, engagementWorkbook()));
  const current = store.data.missions[0], originalRoles = structuredClone(current.engagement!.roles);
  const workbook: SpreadsheetWorkbook = { sheets: [sheet("Engagement roles", [["Application build", "ACORN", "Data engineer", 3, 75]], ["Engagement name", "Client code", "Role name", "Headcount", "Allocation %"])] };
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []); assert.deepEqual(plan.counts, { adds: 0, updates: 1, skips: 0 });
  const next = applySpreadsheetImport(store, plan), role = next.data.missions[0].engagement!.roles[0];
  assert.equal(next.data.missions[0].id, current.id); assert.equal(role.id, originalRoles[0].id);
  assert.equal(role.headcount, 3); assert.equal(role.allocationPercent, 75); assert.deepEqual(role.skills, originalRoles[0].skills);
  assert.deepEqual(next.data.missions[0].engagement!.roles.slice(1), originalRoles.slice(1));
  const legacy = planSpreadsheetImport(next, { sheets: [sheet("Missions", [["Application build", "ACORN"]])] });
  assert.deepEqual(applySpreadsheetImport(next, legacy), next);
});

test("invalid SOW dates, role dates, duplicate keys and unknown parents reject the entire workbook", () => {
  const store = createLocalAdminStore(), before = structuredClone(store);
  const cases = [
    (book: SpreadsheetWorkbook) => { book.sheets[1].rows[4][5] = "2027-02-30"; },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows[4][7] = "2026-12-01"; },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows[4][3] = 1.5; },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows[4][4] = 120; },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows.push([...book.sheets[0].rows[4]]); },
    (book: SpreadsheetWorkbook) => { book.sheets[1].rows.push([...book.sheets[1].rows[4]]); },
    (book: SpreadsheetWorkbook) => { book.sheets.push(sheet("Missions", [["Application build", "ACORN"]])); },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows[4][0] = "Unknown engagement"; },
    (book: SpreadsheetWorkbook) => { book.sheets[1].rows[4][4] = ""; },
    (book: SpreadsheetWorkbook) => { book.sheets[0].rows = book.sheets[0].rows.slice(0, 4); },
  ];
  for (const modify of cases) {
    const book = engagementWorkbook(); modify(book);
    const plan = planSpreadsheetImport(store, book);
    assert.ok(plan.errors.length > 0); assert.throws(() => applySpreadsheetImport(store, plan), code("invalid_import")); assert.deepEqual(store, before);
  }
});

test("People profile columns preserve omitted values and clear only explicitly blank fields", () => {
  let store = imported();
  const withProfile = { sheets: [sheet("People", [["Alex Morgan", "Data", "", "Data engineer; Full stack developer", "SQL, Python"]])] };
  store = applySpreadsheetImport(store, planSpreadsheetImport(store, withProfile));
  const person = store.data.resources[0];
  assert.deepEqual(person.profile, { roles: ["Data engineer", "Full stack developer"], skills: ["SQL", "Python"] });
  const legacy = { sheets: [sheet("People", [["Alex Morgan", "Data", ""]], ["Person name", "HOME code", "Owner name"])] };
  assert.deepEqual(applySpreadsheetImport(store, planSpreadsheetImport(store, legacy)).data.resources[0], person);
  const clearSkills = { sheets: [sheet("People", [["Alex Morgan", "Data", ""]], ["Person name", "HOME code", "Skills"])] };
  const next = applySpreadsheetImport(store, planSpreadsheetImport(store, clearSkills));
  assert.deepEqual(next.data.resources[0].profile, { roles: person.profile!.roles, skills: [] });
  assert.equal(next.data.resources[0].id, person.id);
});

test("Roles and Skills catalogs seed distinct kinds and match renamed aliases without renaming back", () => {
  const empty = createLocalAdminStore(), workbook = { sheets: [sheet("Roles", [["Data engineer", "Builds data products"]]), sheet("Skills", [["SQL", "Relational queries"], ["Data engineer", "A separate skill label"]])] };
  const plan = planSpreadsheetImport(empty, workbook);
  assert.deepEqual(plan.errors, []); assert.equal(plan.counts.adds, 3);
  let store = applySpreadsheetImport(empty, plan);
  const record = store.data.capabilities!.find(item => item.kind === "role")!;
  store = applyLocalAdminCommand(store, { type: "save_capability", id: record.id, expectedRevision: record.revision, kind: "role", name: "Data engineering specialist", description: record.description });
  const updating = planSpreadsheetImport(store, { sheets: [sheet("Roles", [["data engineer", "Designs and operates pipelines"]])] });
  assert.deepEqual(updating.errors, []); assert.equal(updating.counts.updates, 1);
  const next = applySpreadsheetImport(store, updating), saved = next.data.capabilities!.find(item => item.id === record.id)!;
  assert.equal(saved.name, "Data engineering specialist"); assert.deepEqual(saved.aliases, ["Data engineer"]); assert.equal(saved.description, "Designs and operates pipelines");
  const duplicate = planSpreadsheetImport(next, { sheets: [sheet("Roles", [["Data engineer", "First update"], ["Data engineering specialist", "Second update"]])] });
  assert.ok(duplicate.errors.some(issue => issue.message.includes("already matches"))); assert.throws(() => applySpreadsheetImport(next, duplicate), code("invalid_import"));
  const old = planSpreadsheetImport(next, { sheets: [sheet("Clients", [["next", "Next client"]])] });
  assert.deepEqual(applySpreadsheetImport(next, old).data.capabilities, next.data.capabilities);
});

test("quoted role and skill labels survive imports and keep profile matching intact", () => {
  const store = createLocalAdminStore(), workbook = engagementWorkbook();
  workbook.sheets[0].rows[4][2] = "Platform engineer, cloud";
  workbook.sheets[0].rows[4][5] = 'SQL; "Cloud (AWS, Azure)"';
  workbook.sheets.push(sheet("HOMEs", [["DATA", "Data practice"]]), sheet("People", [["Alex Morgan", "DATA", "", '"Platform engineer, cloud"', 'SQL; "Cloud (AWS, Azure)"']]), sheet("Roles", [["Platform engineer, cloud", "Builds cloud platforms"]]), sheet("Skills", [["Cloud (AWS, Azure)", "Cloud engineering"]]));
  const plan = planSpreadsheetImport(store, workbook);
  assert.deepEqual(plan.errors, []);
  const next = applySpreadsheetImport(store, plan), person = next.data.resources[0], role = next.data.missions[0].engagement!.roles[0];
  assert.deepEqual(person.profile, { roles: ["Platform engineer, cloud"], skills: ["SQL", "Cloud (AWS, Azure)"] });
  assert.deepEqual(role.skills, person.profile!.skills);
  const matches = findRoleMatches(role, next.data.resources, next.data.capabilities);
  assert.equal(matches[0].roleMatch, true); assert.deepEqual(matches[0].missingSkills, []);
  const omitted = { sheets: [sheet("Engagement roles", [["Application build", "ACORN", "Platform engineer, cloud", 3, 100]], ["Engagement name", "Client code", "Role name", "Headcount", "Allocation %"])] };
  assert.deepEqual(applySpreadsheetImport(next, planSpreadsheetImport(next, omitted)).data.missions[0].engagement!.roles[0].skills, role.skills);
});

test("malformed list quoting reports its cell and prevents any import", () => {
  const store = createLocalAdminStore();
  for (const target of ["People", "Engagement roles"] as const) {
    const workbook = engagementWorkbook();
    workbook.sheets.push(sheet("HOMEs", [["DATA", "Data practice"]]), sheet("People", [["Alex Morgan", "DATA", "", "Data engineer", "SQL"]]));
    const row = workbook.sheets.find(item => item.name === target)!.rows[4];
    row[target === "People" ? 4 : 5] = 'SQL; "Cloud (AWS, Azure)';
    const plan = planSpreadsheetImport(store, workbook);
    assert.ok(plan.errors.some(error => error.sheet === target && error.row === 5 && error.field === "Skills"));
    assert.throws(() => applySpreadsheetImport(store, plan), code("invalid_import"));
    assert.equal(store.data.clients.length, 0);
  }
});

test("real Excel date and percentage cells become inclusive dates and allocation without losing their units", async () => {
  const entries = unzipSync(new Uint8Array(await readFile(templateUrl)));
  const serial = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const values: Record<string, Record<string, string | number>> = {
    "xl/worksheets/sheet3.xml": { A5: "ACORN", B5: "Acorn Studio" },
    "xl/worksheets/sheet6.xml": { A5: "Application build", B5: "ACORN", C5: "SOW-001", D5: "signed", E5: serial("2026-12-18"), F5: serial("2027-01-01"), G5: serial("2027-06-30") },
    "xl/worksheets/sheet7.xml": { A5: "Application build", B5: "ACORN", C5: "BA / PM", D5: 1, E5: 0.5, F5: "Agile; Testing" },
  };
  let styles = strFromU8(entries["xl/styles.xml"]);
  const prefix = styles.includes("<x:styleSheet") ? "x:" : "";
  const countPattern = new RegExp(`<${prefix}cellXfs count="(\\d+)"`), count = Number(countPattern.exec(styles)![1]);
  styles = styles.replace(countPattern, `<${prefix}cellXfs count="${count + 1}"`).replace(`</${prefix}cellXfs>`, `<${prefix}xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></${prefix}cellXfs>`);
  entries["xl/styles.xml"] = strToU8(styles);
  for (const [name, cells] of Object.entries(values)) {
    let xml = strFromU8(entries[name]);
    const p = xml.includes("<x:worksheet") ? "x:" : "";
    for (const [address, value] of Object.entries(cells)) {
      const cell = new RegExp(`<${p}c r="${address}"([^>]*?)/>`);
      assert.match(xml, cell);
      xml = xml.replace(cell, (_, attributes: string) => {
        const style = name.endsWith("sheet7.xml") && address === "E5" ? attributes.replace(/\bs="\d+"/, `s="${count}"`) : attributes;
        return `<${p}c r="${address}"${style}${typeof value === "string" ? ' t="str"' : ""}><${p}v>${value}</${p}v></${p}c>`;
      });
    }
    entries[name] = strToU8(xml);
  }
  const parsed = await readSpreadsheetFile(new File([new Uint8Array(zipSync(entries))], "dated-sow.xlsx"));
  const empty = createLocalAdminStore(), plan = planSpreadsheetImport(empty, parsed);
  assert.deepEqual(plan.errors, []);
  const engagement = applySpreadsheetImport(empty, plan).data.missions[0].engagement!;
  assert.equal(engagement.start, "2027-01-01"); assert.equal(engagement.end, "2027-06-30"); assert.equal(engagement.signedOn, "2026-12-18");
  assert.equal(engagement.roles[0].allocationPercent, 50);
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
