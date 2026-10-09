# Handling a legal request for a contact record

This is an operating procedure, not legal advice. Laws differ by country and state, and a lawyer who knows
yours should review it, especially the retention period and what you may disclose.

## What exists
When someone creates an account, the site stores a **contact record**: their email address, encrypted to the
owner's public key. The server cannot read it back. The matching private key is held only by the owner, offline.
Opening a record is done with `npm run contacts:lookup` and is written to an append-only log (`contact_access_log`)
**before** anything is decrypted.

The contact record is the only thing this procedure releases. It does not include passwords (never stored in
readable form), research activity, or anything about the owner's own data.

## When a request arrives
1. **Record the request.** Save the original message and attachments. Note the date, the sender, and the
   deadline it states.
2. **Check it is genuine.** It should come from an official agency address and quote a case or order number.
   Do not rely on the phone number or links in the message. Find the agency's published number yourself and
   confirm by calling back.
3. **Check it is valid.** A court order, warrant, or subpoena issued under the law that applies to you.
   An informal email asking for information is not enough on its own. If unsure, ask a lawyer before replying.
4. **Check its scope.** Release only what the request names, and only the contact record. If it asks for more
   than the contact record holds, say what you do not have.
5. **Emergencies.** A genuine, documented claim of imminent danger to a person may justify releasing sooner.
   Write down why, and tell a lawyer afterwards.
6. **Tell the person if you may.** Unless the order forbids it or notice would put someone at risk, tell the
   account holder before releasing, so they can object.

## Opening the record
```
npm run contacts:lookup -- --email person@example.com --key "<path to private key>" \
  --reason "Court order requesting contact details for the account" --ref "<court / case number>"
```
You can use `--user <account id>` instead of `--email`. `--reason` and `--ref` are required, and the access is
logged before decryption. Copy only the fields the request asks for into your reply. Do not save the decrypted
output anywhere else.

## After
- Reply in writing and keep a copy of the request and your reply with the log entry's date.
- Review the access log now and then. Every row should match a request you can account for:
  `select * from contact_access_log order by accessed_at desc;`

## Retention
When an account is deleted, its contact record is kept for **12 months**, then removed. Remove expired records
about monthly:
```
npm run contacts:lookup -- purge-expired --reason "monthly retention purge" --ref "retention policy"
```
If a record is under a legal hold, do not purge until the hold is lifted. Keep the privacy policy's stated
period in step with this one.

## The private key
- It lives only in offline storage, in at least two places. Anyone holding it can open every record.
- If it is lost, existing records can never be opened by anyone. Back it up before opening sign-up.
- If it may have been exposed, generate a new pair, deploy the new public key, and keep the old private key
  to open the older records (they carry a `key_version`).
