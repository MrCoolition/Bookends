# Everyday administration

Open **Admin** in the app's main navigation. You can also find it through command search or appearance settings.

## Open setup now

The current release enables local administration without sign-in. Configure clients, HOMEs, people, engagements, roles and skills, playbooks, and access settings. Start with your company name, HOMEs, and clients. Delivery roles such as Data engineer or BA / PM describe the work your business delivers; permission roles in Access are separate. Local Access entries do not create sign-in accounts or grant server permissions.

Changes save in this browser on this site. They survive a refresh, but do not sync to another browser, device, or the fictional staffing preview. Use **Export setup** to keep a JSON backup. **Import setup** validates a backup and asks before replacing this browser's configuration. Clearing browser storage removes the local copy. A failed browser save is reported instead of claiming success.

The deployed setup starts with the nine company-provided clients: Big 4, TQL, Nisource, Compass, Vantive, Others, Chipotle, Safelite, and First Bank of Ohio. New browsers and older setups receive missing clients once. Existing matches retain their IDs, names, contacts, and inactive status; later renames and archives are preserved. Older backup reviews include any missing starting clients before you confirm restoration. This starting list is deployed with the app; subsequent edits still remain in each browser.

This mode is selected by `BOOKENDS_ADMIN_MODE=local`. Set it to `protected` to return to sign-in. `BOOKENDS_MODE=production` always uses protected administration. The operational API and database remain separate; importing a local backup does not activate accounts or publish policies to them.

## Plan an engagement around its SOW

Open **Engagements → Add engagement**. The three steps capture the SOW and its delivery dates, the team needed, and a review before saving. A months-long engagement has one client, a SOW reference and status, intended outcomes, and at least one delivery role. A signed or completed SOW also needs its signature date.

For each role, enter headcount, allocation per person, skills, responsibilities, and dates. For example, an application build might need two Data engineers at 100%, three Full stack developers at 100%, and one BA / PM at 50% to run boards and ceremonies, maintain requirements, and perform light testing. Role dates can cover the whole engagement or a shorter phase. Both the engagement and role end dates include the last day; no fixed 40-hour week is assumed.

The review shows role positions, the engagement span, and peak FTE demand. FTE is headcount multiplied by allocation, accounting for overlapping role dates. These are delivery needs, not assigned teammates. Adding SOW details to an existing mission keeps its ID and linked journey history.

## Define roles, skills, and teammate profiles

Use **Roles & skills** to add your business's delivery roles and skills, with optional descriptions. Configured entries become choices in People and Engagements. You can rename entries; former names remain connected for matching. Making an entry inactive removes it from new choices while preserving recorded profiles and plans.

In **People**, record each teammate's delivery roles and skills alongside their HOME and owner. Profiles are optional, so earlier records and backups remain valid. Engagement review uses these recorded profiles to show role and skill alignment, including missing skills. A match does not check availability, book capacity, create an assignment, or grant access. The synthetic weekly planner remains a separate preview.

## Fill setup from Excel

Use **Download Excel template** at the top of Admin. The workbook includes a **Start here** guide and eight blank input tabs. Paste values starting on row 5; keep the sheet names and row-4 headers. Blue headings identify required columns. Fictional examples appear only on the ignored guide sheet.

| Tab | Required columns | Optional columns |
| --- | --- | --- |
| HOMEs | HOME code, HOME name | Description |
| Clients | Client code, Client name | Contact name, Contact email, Notes |
| People | Person name, HOME code | Owner name, Delivery roles, Skills |
| Engagements | Engagement name, Client code, Start date, End date | SOW reference, Status, Signed on, Outcomes |
| Engagement roles | Engagement name, Client code, Role name, Headcount, Allocation % | Skills, Responsibilities, Start date, End date |
| Roles | Name | Description |
| Skills | Name | Description |
| Missions | Mission name, Client code | — |

Enter HOME and client codes once, then reuse them across tabs. Link each Engagement roles row by the exact engagement name and client code; the importer resolves parents even when sheets appear in another order. Every engagement needs at least one role, with no more than 100 roles per engagement. The older Missions tab still accepts names and client links; do not list the same engagement on both Missions and Engagements.

Use Excel dates or `YYYY-MM-DD`. Blank role dates use the engagement's dates. Enter whole-person headcount and allocation from 1 to 100, such as `50` for half-time; native Excel percentage cells such as `50%` also work. Status accepts `draft`, `signed`, or `complete`; blank Status becomes `draft`. Signed and complete rows require SOW reference and Signed on. Separate delivery roles or skills with semicolons or commas. Put names containing separators in double quotes, for example `SQL; "Cloud (AWS, Azure)"`. Inside a quoted name, write a literal quote twice. Unclosed or malformed quoting must be fixed before importing.

Leave Owner name blank to use the workspace owner, or enter an existing active local member's exact name. Use values rather than formulas. Fill any needed tabs, up to 1,000 rows per tab and a 5 MiB workbook. The saved workspace also has a 1,000-record limit per section, with Roles and Skills sharing one catalog limit.

Choose **Import Excel**, select the saved `.xlsx`, and review the additions, updates, and unchanged rows. Errors name the sheet, row, and column to fix. No part of a workbook is saved while any issue remains. After reviewing a valid batch, check the confirmation and choose **Apply import**. If another tab changes setup, refresh and review the workbook again.

Imports merge into the setup already saved in this browser:

- HOMEs and clients match by their stable code. Reimporting changed fields updates the same record and preserves its links.
- People match by exact name plus HOME code; engagements and legacy missions match by exact name plus client code. Engagement roles match by role name within that engagement, ignoring capitalization. Existing IDs and unlisted roles are preserved. Rename or transfer records through their Admin forms to avoid creating a second record.
- Roles and Skills match names or former names within the same catalog type, ignoring capitalization. An older name keeps the current canonical name instead of renaming it back.
- Matching unchanged rows are skipped. Records absent from the workbook are kept; the import never deletes or archives records.
- Omitted optional columns preserve saved values. Present blank optional cells clear those fields, except the documented Owner name, Status, and role-date defaults. For example, a blank Skills column clears skills but an omitted Delivery roles column keeps those roles. Review the individual field changes before applying an update.
- Archived matches, duplicate keys, missing references, formulas, and unexpected populated columns must be corrected first.

Excel imports stay in this browser, just like manual setup. **Export setup** under **JSON backup** saves the complete configuration, including SOW plans, profiles, catalogs, playbooks, and local access entries. **Import setup** restores a whole JSON backup and replaces the local setup after review.

## Connected administration later

After identity and database activation, **Administration** in the signed-in journey workspace manages shared company configuration. Apply `db/migrations/0003_engagement_planning.sql` with the migration runner before activating this release's protected administration. It adds engagement plans and teammate profiles to existing records, plus the organization-scoped role and skill catalog. Deployment alone does not run migrations.

Teammates and scoped operational reviewers use their journey views. Local setup needs an explicit reviewed migration into that shared workspace; it is never promoted automatically.

## Initial setup order

1. **HOMEs:** add the teams or practices that own people. Choose a stable code and a readable display name.
2. **Clients:** add each client once, with a stable code, name, optional business contact, and useful notes.
3. **Roles & skills:** define the delivery vocabulary shared by profiles and engagements.
4. **People:** add teammates, choose their HOME and owner, and record their delivery roles and skills.
5. **Engagements:** choose a client, enter the SOW and dates, and define the role demand before reviewing teammate matches.
6. **Access:** in local setup, plan access entries. After protected activation, link provider-verified identities to the correct teammate and explicit permissions. Do not infer an identity from an email address.
7. **Playbooks:** review the four starter journeys, tailor the requirements, record approved policy sources, and approve the intended version.

The first workspace administrator still requires one-time provisioning after sign-in and database setup. See `production-setup.md`. Subsequent everyday configuration uses the admin interface.

## Change records without losing history

Search the relevant section, open a record, change its fields, and save. Changes carry a revision. If someone else saved first, refresh the record and review the newer values before retrying; do not assume your change was applied.

Archive records that should stop appearing in new-work choices. Archive is reversible and preserves the links from existing journeys. Archiving a person record does not automatically terminate employment, revoke accounts, or delete history. Workspace access is managed explicitly in the Access section.

Client and HOME codes are stable identifiers; their display names can change. Existing mission/client and teammate/HOME relationships may be locked once journey history depends on them. A real transfer needs its own reviewed transition, rather than relabeling the past.

## Adjust a playbook

Each of the four journeys has its own versioned playbook: company welcome, company farewell, mission arrival, and mission departure. Edit titles, guidance, evidence rules, verification roles, prerequisite relationships, timing, and action-specific requirements in a draft.

Approve a draft only after the accountable policy owner has reviewed its source and scope. To change an approved playbook, create a new version. Existing journeys retain the requirements they started with; later journeys use the newly approved version. Retirement prevents future use without erasing history.

Every instantiated step has its own owner, fulfiller, and independent verifier. Use step-specific assignments when equipment, access, mission, and people teams have different responsibilities. Submitting evidence requests verification; it does not mark a requirement complete.

## Manage access deliberately

Use the immutable subject from the organization's verified sign-in provider when adding an account. The server fixes the issuer to the organization identity used by the administrator. Link the correct teammate record, choose the primary role, and grant only the additional verification scopes needed. A role grant and a client contact email are different things.

Another administrator must change your own access. Disabling an account prevents later authenticated business requests; it does not revoke external systems or change employment. Keep an active workspace administrator available.

Email delivery and external identity/access provisioning are not performed by these forms. Configuration changes, audits, and in-app records persist through the protected server/database once the operational environment has been activated.
