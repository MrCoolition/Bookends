# AI SOW reading

The explicit **Bring the plan to life** button sends one SOW or pasted brief to OpenAI Responses using the configured `gpt-6.1-sol` model. The connection uses the existing server-only Vercel secret `chaz_gpt`; `OPENAI_API_KEY` is a fallback for local environments. Set `BOOKENDS_AI_MODEL=gpt-6.1-sol`. `BOOKENDS_AI_ENABLED=false` pauses reading while the direct team-planning path stays available. There is no AI Gateway fallback.

AI is limited to document interpretation. Loading the studio, checking reader availability, manual team entry, skill matching, timeline calculations, capacity rules, administration, and saving plans use application logic and stored data. They make no model requests. Reading is never triggered automatically by selecting a file or changing an input.

Each authenticated workspace can attempt at most three reads per minute and twenty per day. Counters are shared across deployment instances and include provider failures. Each model request uses low reasoning, at most 8,000 output tokens, a 55-second timeout, and zero automatic retries. A stopped request is aborted; a user may explicitly try again. Input limits are 3 MB per file and 60,000 text characters. DOCX extraction additionally bounds decompressed XML to 2 MB. The actual HTTP body is bounded even without a Content-Length header.

PDFs are passed inline to the model. DOCX text is extracted locally without fetching document links or running embedded content; TXT and pasted briefs are sent as text. Original uploads are not persisted by BOOKENDS. OpenAI requests set `store:false`; this does not make a claim about separate provider abuse-monitoring retention policies. Provider error messages and document bodies are not logged. The API returns curated errors only.

The model has no tools and cannot save an engagement, assign people, approve staffing, or follow document instructions. Its structured response contains a proposed brief, delivery roles, source quotations, and open questions. Unknown fields stay blank. Text/DOCX quotations are checked against the extracted source; unsupported fields are cleared. **Quote found in source** means the quoted text exists, not that the interpretation is correct. PDF quotations remain explicitly unverified and must be checked against the original.

The user reviews and edits the brief, fills any missing role quantities, allocation, and dates, chooses teammates, and explicitly saves the plan. Saved intake evidence records the original extraction; later edits do not rewrite the source quotations. Teammate selections remain proposals until normal capacity and approval checks are completed.

Provider SDK implementation is verified against installed `@ai-sdk/openai` documentation. The selected model is documented at https://developers.openai.com/api/docs/models/gpt-6.1-sol. No API key belongs in source code, browser storage, chat, or tracked environment examples.
