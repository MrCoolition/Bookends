import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Use Codex's bundled artifact runtime; no application dependency is needed.
// Set BOOKENDS_ARTIFACT_NODE_MODULES and BOOKENDS_ARTIFACT_PYTHON from
// load_workspace_dependencies, then run with that runtime's Node executable.
const runtimeModules = process.env.BOOKENDS_ARTIFACT_NODE_MODULES;
const runtimePython = process.env.BOOKENDS_ARTIFACT_PYTHON;
if (!runtimeModules || !runtimePython) throw new Error('Set BOOKENDS_ARTIFACT_NODE_MODULES and BOOKENDS_ARTIFACT_PYTHON to the bundled artifact runtime paths.');
const runtimeRequire = createRequire(path.join(path.resolve(runtimeModules), '__bookends_loader__.cjs'));
const { FileBlob, SpreadsheetFile, Workbook } = await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const working = path.join(root, '.tmp', 'bookends-seed');
await fs.mkdir(working, { recursive: true });

const output = path.join(root, 'public', 'templates', 'BOOKENDS_Seed_Template.xlsx');
if (process.argv.includes('--render-before')) {
  const existing = await SpreadsheetFile.importXlsx(await FileBlob.load(output));
  const rendered = await existing.render({ sheetName: 'Start here', range: 'A1:F53', scale: 1, format: 'png' });
  await fs.writeFile(path.join(working, 'before.png'), new Uint8Array(await rendered.arrayBuffer()));
  console.log((await existing.inspect({ kind: 'sheet', include: 'id,name', maxChars: 1200 })).ndjson);
  process.exit(0);
}
function normalizeXmlNamespaces() {
  const script = `import os, posixpath, re, sys, zipfile, xml.etree.ElementTree as E
p=sys.argv[1]
uri='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
def semantic(e):
    return (e.tag, sorted(e.attrib.items()), e.text, e.tail, [semantic(c) for c in e])
changed=0
with zipfile.ZipFile(p) as source, zipfile.ZipFile(p+'.tmp','w') as target:
    for entry in source.infolist():
        payload=source.read(entry.filename)
        if entry.filename.endswith('.xml'):
            text=payload.decode('utf-8-sig')
            if 'xmlns:x="'+uri+'"' in text:
                normalized=re.sub(r'(<\\/?)x:',r'\\1',text).replace('xmlns:x="'+uri+'"','xmlns="'+uri+'"')
                assert semantic(E.fromstring(text))==semantic(E.fromstring(normalized)), entry.filename
                payload=normalized.encode('utf-8')
                changed+=1
        elif entry.filename.endswith('.rels'):
            text=payload.decode('utf-8-sig')
            base=posixpath.dirname(posixpath.dirname(entry.filename))
            normalized=re.sub(r'Target="(/[^\"]+)"',lambda m: 'Target="'+posixpath.relpath(m.group(1).lstrip('/'),base or '.')+'"',text)
            before,after=E.fromstring(text),E.fromstring(normalized)
            for old,new in zip(before,after):
                oldTarget=posixpath.normpath(old.attrib['Target'] if old.attrib['Target'].startswith('/') else '/'+posixpath.join(base,old.attrib['Target']))
                newTarget=posixpath.normpath('/'+posixpath.join(base,new.attrib['Target']))
                assert oldTarget==newTarget,entry.filename
                assert {k:v for k,v in old.attrib.items() if k!='Target'}=={k:v for k,v in new.attrib.items() if k!='Target'}
            payload=normalized.encode('utf-8')
        target.writestr(entry,payload)
os.replace(p+'.tmp',p)
print('Canonicalized SpreadsheetML parts without semantic changes:',changed)
`;
  console.log(execFileSync(runtimePython, ['-c', script, output], { encoding: 'utf8' }).trim());
}
if (process.argv.includes('--normalize-only')) { normalizeXmlNamespaces(); process.exit(0); }

const workbook = Workbook.create();
if (process.argv.includes('--help-names')) {
  console.log(workbook.help('defined names', { search: 'definedNames|names.add|namedItems', include: 'index,examples,notes', maxChars: 5000 }).ndjson);
  process.exit(0);
}

const previews = path.join(working, 'previews');
const color = { paper: '#F8F6F1', white: '#FFFFFF', ink: '#20283F', muted: '#657088', cobalt: '#315BFF', coral: '#EF7968', line: '#E6E3DC', optional: '#45516B', input: '#FFFCF5' };
const sheetSpecs = [
  { name: 'HOMEs', title: 'HOMEs', note: 'Enter one HOME per row. The first two columns are required.', headers: ['HOME code', 'HOME name', 'Description'], widths: [26, 38, 64] },
  { name: 'Clients', title: 'Clients', note: 'Enter one client per row. The first two columns are required.', headers: ['Client code', 'Client name', 'Contact name', 'Contact email', 'Notes'], widths: [22, 34, 28, 37, 48] },
  { name: 'People', title: 'People', note: 'Name and HOME are required. Separate delivery roles and skills with semicolons. Owner is optional.', headers: ['Person name', 'HOME code', 'Owner name', 'Delivery roles', 'Skills'], widths: [32, 22, 28, 43, 48] },
  { name: 'Missions', title: 'Missions', note: 'Enter one mission per row. Both columns are required.', headers: ['Mission name', 'Client code'], widths: [58, 48] },
  { name: 'Engagements', title: 'Engagements / SOWs', note: 'One SOW engagement per row. Add its team on Engagement roles. Dates include the last day.', headers: ['Engagement name', 'Client code', 'SOW reference', 'Status', 'Signed on', 'Start date', 'End date', 'Outcomes'], widths: [35, 20, 26, 18, 18, 18, 18, 54], required: [0,1,5,6] },
  { name: 'Engagement roles', title: 'Engagement roles / your delivery team', note: 'One row per role. Enter allocation as 100 for full-time or 50 for half-time. Blank dates use engagement dates.', headers: ['Engagement name', 'Client code', 'Role name', 'Headcount', 'Allocation %', 'Skills', 'Responsibilities', 'Start date', 'End date'], widths: [35, 20, 30, 17, 20, 44, 60, 18, 18], required: [0,1,2,3,4] },
  { name: 'Roles', title: 'Delivery roles / your role catalog', note: 'Define the delivery roles your business uses. Name is required; Description is optional.', headers: ['Name', 'Description'], widths: [48, 86], required: [0] },
  { name: 'Skills', title: 'Skills / your skills catalog', note: 'Define the skills your business uses. Name is required; Description is optional.', headers: ['Name', 'Description'], widths: [48, 86], required: [0] },
];

const guide = workbook.worksheets.add('Start here');
for (const spec of sheetSpecs) workbook.worksheets.add(spec.name);

guide.showGridLines = false;
guide.tabColor = color.cobalt;
guide.getRange('A1:F53').format = { fill: color.paper, font: { name: 'Arial', size: 11, color: color.ink }, verticalAlignment: 'center', rowHeight: 24 };
guide.getRange('A1:A34').format.columnWidth = 4;
guide.getRange('B1:B34').format.columnWidth = 23;
guide.getRange('C1:C34').format.columnWidth = 27;
guide.getRange('D1:D34').format.columnWidth = 29;
guide.getRange('E1:E34').format.columnWidth = 28;
guide.getRange('F1:F34').format.columnWidth = 4;
guide.getRange('B2').values = [['BOOKENDS']];
guide.getRange('B2:E2').format.font = { name: 'Arial', size: 11, bold: true, color: color.cobalt };
guide.getRange('B3').values = [['Workspace seed template']];
guide.getRange('B3:E3').format = { font: { name: 'Arial', size: 17, bold: true, color: color.ink }, rowHeight: 33 };
guide.getRange('B4:E4').format = { rowHeight: 8, borders: { bottom: { style: 'medium', color: color.coral } } };
guide.getRange('B6').values = [['1. Set up the basics']];
guide.getRange('C6').values = [['Add HOMEs and Clients. Define Roles and Skills, then add People.']];
guide.getRange('B7').values = [['2. Build the team']];
guide.getRange('C7').values = [['Add Engagements, then Engagement roles. Match engagement names and client codes.']];
guide.getRange('B8').values = [['3. Review in Admin']];
guide.getRange('C8').values = [['Save as .xlsx, choose Import Excel in Admin, then review before applying.']];
guide.getRange('B6:B8').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('B10').values = [['Input rules']];
guide.getRange('B10:E10').format = { fill: color.cobalt, font: { name: 'Arial', size: 11, bold: true, color: color.white }, rowHeight: 27 };
guide.getRange('B11').values = [['Required fields']];
guide.getRange('C11').values = [['Blue headings are required. All other columns are optional unless noted below.']];
guide.getRange('B12').values = [['Owner name']];
guide.getRange('C12').values = [['Optional. Leave blank for the workspace owner, or match an existing owner name.']];
guide.getRange('B13').values = [['Codes']];
guide.getRange('C13').values = [['Use unique HOME and client codes. Match names and codes exactly across tabs.']];
guide.getRange('B14').values = [['Input area']];
guide.getRange('C14').values = [['Start in row 5. Up to 1,000 rows per tab. Blank rows are skipped.']];
guide.getRange('B15').values = [['Keep the structure']];
guide.getRange('C15').values = [['Keep sheet names and row 4 headers unchanged. Paste values only.']];
guide.getRange('B16').values = [['Local setup']];
guide.getRange('C16').values = [['Imports configure this browser workspace. They do not create sign-in accounts.']];
guide.getRange('B11:B16').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('B18').values = [['Fictional examples']];
guide.getRange('C18').values = [['For reference only. This guide tab is never imported.']];
guide.getRange('B18:E18').format = { fill: '#FCE9E3', rowHeight: 28 };
guide.getRange('B18').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('B20:E20').values = [['Tab', 'First required field', 'Second required field', 'Meaning']];
guide.getRange('B20:E20').format = { fill: color.optional, font: { name: 'Arial', size: 11, bold: true, color: color.white }, rowHeight: 27 };
guide.getRange('B21:E24').values = [
  ['HOMEs', 'DESIGN', 'Design studio', 'Create this HOME'],
  ['Clients', 'ACORN', 'Acorn Studio', 'Create this client'],
  ['People', 'Taylor Example', 'DESIGN', 'Person belongs to DESIGN'],
  ['Missions', 'Acorn website', 'ACORN', 'Mission belongs to ACORN'],
];
guide.getRange('B21:E24').format = { fill: color.white, rowHeight: 26, borders: { insideHorizontal: { style: 'thin', color: color.line } } };
guide.getRange('B26').values = [['Ready to begin']];
guide.getRange('C26').values = [['Open HOMEs and enter your first record in row 5.']];
guide.getRange('B26').format.font = { name: 'Arial', size: 11, bold: true, color: color.cobalt };
guide.getRange('C6:E16').format.font.color = color.muted;
guide.getRange('C18:E18').format.font.color = color.muted;
guide.getRange('C26:E26').format.font.color = color.muted;
guide.getRange('B28').values = [['Importing again']];
guide.getRange('B28:E28').format = { fill: '#FCE9E3', font: { name: 'Arial', size: 11, bold: true, color: color.ink }, rowHeight: 28 };
guide.getRange('B29').values = [['Matching codes']];
guide.getRange('C29').values = [['Matching HOME and client codes update existing records.']];
guide.getRange('B30').values = [['Optional fields']];
guide.getRange('C30').values = [['Blank optional cells clear saved values. Blank Owner name uses the workspace owner.']];
guide.getRange('B31').values = [['Names and roles']];
guide.getRange('C31').values = [['Rename in Admin. New names add records. Unlisted delivery roles are kept.']];
guide.getRange('B32').values = [['Review first']];
guide.getRange('C32').values = [['Check each update in the import preview before applying it.']];
guide.getRange('B29:B32').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('C29:E32').format.font.color = color.muted;
guide.getRange('B34').values = [['SOWs and delivery teams']];
guide.getRange('B34:E34').format = { fill: color.cobalt, font: { name: 'Arial', size: 11, bold: true, color: color.white }, rowHeight: 28 };
guide.getRange('B35').values = [['Engagement example']];
guide.getRange('C35').values = [['ACORN / Application build / SOW-2027-001 / Jan 1 – Jun 30, 2027.']];
guide.getRange('B36').values = [['Role examples']];
guide.getRange('C36').values = [['2 Data engineers at 100%; 3 Full stack developers at 100%; 1 BA / PM at 50%.']];
guide.getRange('B37').values = [['Skills']];
guide.getRange('C37').values = [['Data engineer: SQL; Python. Full stack: React; TypeScript. BA / PM: Agile; Testing.']];
guide.getRange('B38').values = [['Responsibilities']];
guide.getRange('C38').values = [['BA / PM: boards, agile ceremonies, requirements and light testing.']];
guide.getRange('B39').values = [['Dates']];
guide.getRange('C39').values = [['Enter Excel dates or YYYY-MM-DD. Role dates must fit inside engagement dates.']];
guide.getRange('B40').values = [['Headcount / allocation']];
guide.getRange('C40').values = [['Headcount = people needed. Allocation = each person’s share, from 1 to 100.']];
guide.getRange('B41').values = [['Signed / complete']];
guide.getRange('C41').values = [['Both require a SOW reference and Signed on date. Blank Status becomes draft.']];
guide.getRange('B42').values = [['Role dates']];
guide.getRange('C42').values = [['Blank role dates use the full engagement. Use dates for a shorter delivery phase.']];
guide.getRange('B43').values = [['Updating roles']];
guide.getRange('C43').values = [['Match client + engagement + role name to update. Omitted roles are never removed.']];
guide.getRange('B44').values = [['Required team']];
guide.getRange('C44').values = [['Every engagement needs at least one role. Skills use semicolons or commas.']];
guide.getRange('B45').values = [['Earlier workbooks']];
guide.getRange('C45').values = [['Missions is supported for names only. Use Engagements for SOWs and team demand.']];
guide.getRange('B46').values = [['Optional columns']];
guide.getRange('C46').values = [['Remove an optional column to keep saved values. Present blank cells clear values.']];
guide.getRange('B35:B46').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('C35:E46').format.font.color = color.muted;
guide.getRange('B48').values = [['Your role and skills catalog']];
guide.getRange('B48:E48').format = { fill: '#FCE9E3', font: { name: 'Arial', size: 11, bold: true, color: color.ink }, rowHeight: 28 };
guide.getRange('B49').values = [['Roles / Skills']];
guide.getRange('C49').values = [['Add your business vocabulary with a name and optional description on each tab.']];
guide.getRange('B50').values = [['Use matching names']];
guide.getRange('C50').values = [['Use catalog names in People and Engagement roles so matching stays consistent.']];
guide.getRange('B51').values = [['Rename in Admin']];
guide.getRange('C51').values = [['Older names still match a renamed catalog item. Imports keep its current name.']];
guide.getRange('B52').values = [['Names with punctuation']];
guide.getRange('C52').values = [['Quote names containing separators, for example: SQL; "Cloud (AWS, Azure)".']];
guide.getRange('B49:B52').format.font = { name: 'Arial', size: 11, bold: true, color: color.ink };
guide.getRange('C49:E52').format.font.color = color.muted;

for (const spec of sheetSpecs) {
  const sheet = workbook.worksheets.getItem(spec.name);
  const last = String.fromCharCode(64 + spec.headers.length);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(4);
  sheet.tabColor = spec.name === 'HOMEs' || spec.name === 'Clients' ? color.cobalt : color.coral;
  sheet.getRange(`A1:${last}1004`).format = { font: { name: 'Arial', size: 11, color: color.ink }, verticalAlignment: 'center', rowHeight: 24 };
  spec.widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, 1004, 1).format.columnWidth = width; });
  sheet.getRange(`A1:${last}3`).format.fill = color.paper;
  sheet.getRange('A1').values = [[spec.title]];
  sheet.getRange(`A1:${last}1`).format = { rowHeight: 37, font: { name: 'Arial', size: 17, bold: true, color: color.ink } };
  sheet.getRange('A2').values = [[spec.note]];
  sheet.getRange(`A2:${last}2`).format = { rowHeight: 25, font: { name: 'Arial', size: 11, color: color.muted } };
  sheet.getRange(`A3:${last}3`).format.rowHeight = 10;
  sheet.getRange(`A4:${last}4`).values = [spec.headers];
  const table = sheet.tables.add(`A4:${last}1004`, true, `Bookends${spec.name.replaceAll(' ', '')}Inputs`);
  table.style = 'TableStyleLight1';
  table.showFilterButton = true;
  table.showTotals = false;
  sheet.getRange(`A5:${last}1004`).format = { fill: color.white, numberFormat: '@', borders: { insideHorizontal: { style: 'thin', color: color.line } } };
  sheet.getRange(`A4:${last}4`).format = { fill: color.optional, font: { name: 'Arial', size: 11, bold: true, color: color.white }, horizontalAlignment: 'center', rowHeight: 29, borders: { insideVertical: { style: 'thin', color: color.white }, bottom: { style: 'medium', color: color.coral } } };
  for (const column of spec.required ?? [0,1]) {
    sheet.getRangeByIndexes(3, column, 1, 1).format.fill = color.cobalt;
    sheet.getRangeByIndexes(4, column, 1000, 1).format.fill = color.input;
  }
  if (spec.name === 'Engagements') sheet.getRange('E5:G1004').format.numberFormat = 'mm/dd/yyyy';
  if (spec.name === 'Engagement roles') {
    sheet.getRange('D5:E1004').format.numberFormat = '0';
    sheet.getRange('H5:I1004').format.numberFormat = 'mm/dd/yyyy';
    sheet.getRange('D5:D1004').dataValidation = { rule: { type: 'whole', operator: 'between', formula1: 1, formula2: 1000 } };
    sheet.getRange('E5:E1004').dataValidation = { rule: { type: 'decimal', operator: 'between', formula1: 1, formula2: 100 } };
  }
}

workbook.names.add('BookendsHomeCodes', "='HOMEs'!$A$5:$A$1004");
workbook.names.add('BookendsClientCodes', "='Clients'!$A$5:$A$1004");
workbook.worksheets.getItem('People').getRange('B5:B1004').dataValidation = { rule: { type: 'list', formula1: 'BookendsHomeCodes' } };
workbook.worksheets.getItem('Missions').getRange('B5:B1004').dataValidation = { rule: { type: 'list', formula1: 'BookendsClientCodes' } };
workbook.worksheets.getItem('Engagements').getRange('B5:B1004').dataValidation = { rule: { type: 'list', formula1: 'BookendsClientCodes' } };
workbook.worksheets.getItem('Engagement roles').getRange('B5:B1004').dataValidation = { rule: { type: 'list', formula1: 'BookendsClientCodes' } };
workbook.worksheets.getItem('Engagements').getRange('D5:D1004').dataValidation = { rule: { type: 'list', values: ['draft', 'signed', 'complete'] } };

workbook.recalculate();
await fs.mkdir(previews, { recursive: true });
for (const name of ['Start here', ...sheetSpecs.map(s => s.name)]) {
  const range = name === 'Start here' ? 'A1:F53' : `A1:${String.fromCharCode(64 + sheetSpecs.find(s => s.name === name).headers.length)}13`;
  const check = await workbook.inspect({ kind: 'table', range: `'${name}'!${name === 'Start here' ? 'B18:E24' : 'A4:E6'}`, include: 'values,formulas', tableMaxRows: 7, tableMaxCols: 5, maxChars: 1600 });
  console.log(check.ndjson);
  if (!process.argv.includes('--guide-only-render') || name === 'Start here') {
    const render = await workbook.render({ sheetName: name, range, scale: 1.5, format: 'png' });
    await fs.writeFile(`${previews}/${name.replaceAll(' ', '-')}.png`, new Uint8Array(await render.arrayBuffer()));
  }
}
console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan', maxChars: 1200 })).ndjson);
await fs.mkdir(path.dirname(output), { recursive: true });
await (await SpreadsheetFile.exportXlsx(workbook)).save(output);
normalizeXmlNamespaces();
await fs.rename(`${output}.inspect.ndjson`, path.join(working, 'export.inspect.ndjson'));
console.log(`Saved ${output}`);
