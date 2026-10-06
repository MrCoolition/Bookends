# Everyday administration

Open **Admin** in the app's main navigation. You can also find it through command search or appearance settings.

## Open setup now

The current release enables local administration without sign-in. All six sections are editable. Start with your company name, HOMEs, and clients, then connect people and missions. Access entries are planned local roles; they do not create sign-in accounts or grant server permissions.

Changes save in this browser on this site. They survive a refresh, but do not sync to another browser, device, or the fictional staffing preview. Use **Export setup** to keep a JSON backup. **Import setup** validates a backup and asks before replacing this browser's configuration. Clearing browser storage removes the local copy. A failed browser save is reported instead of claiming success.

This mode is selected by `BOOKENDS_ADMIN_MODE=local`. Set it to `protected` to return to sign-in. `BOOKENDS_MODE=production` always uses protected administration. The operational API and database remain separate; importing a local backup does not activate accounts or publish policies to them.

## Connected administration later

After identity and database activation, **Administration** in the signed-in journey workspace manages shared company configuration. Teammates and scoped operational reviewers use their journey views. Local setup needs an explicit reviewed migration into that shared workspace; it is never promoted automatically.

## Initial setup order

1. **HOMEs:** add the teams or practices that own people. Choose a stable code and a readable display name.
2. **Clients:** add each client once, with a stable code, name, optional business contact, and useful notes.
3. **People:** add teammates, choose their HOME, and assign an authorized owner.
4. **Missions:** name the work and choose an existing active client.
5. **Access:** link approved, provider-verified identities to the correct teammate and explicit permissions. Do not infer an identity from an email address.
6. **Playbooks:** review the four starter journeys, tailor the requirements, record approved policy sources, and approve the intended version.

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
