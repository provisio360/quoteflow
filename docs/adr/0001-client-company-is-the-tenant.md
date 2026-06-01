# Client company is the tenant

QuoteFlow is operated by a single research firm. We make the **client company** the tenant and isolation boundary: each client's studies, benchmark items, and quotes are walled off from every other client. Researchers and analysts are **internal staff who work across all tenants** and are not scoped to any one client; clients are the only external users and see only their own data.

We rejected making the research agency the tenant (a multi-agency SaaS model) because there is only one operator today and that design adds a second isolation layer we don't need. If QuoteFlow is ever sold to other agencies, an "organization" layer can be added above the client tenant rather than reworking it.
