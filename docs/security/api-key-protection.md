# How Your AI API Key Is Protected

*AI Triad Research · Taxonomy Editor*

This page explains, in plain terms, what happens to the AI provider API key (for example, your Google Gemini key) that you enter in **Settings → API Keys**: where it is stored, whether it travels over the network, who can see it, and how you can keep it safe. It reflects how the application actually works, including the parts that depend on your key rather than ours.

The short version: **the strength of the protection depends on which version of the app you use and whether you are signed in.** The desktop app keeps your key on your own machine. The web app relies on the server to talk to the AI provider on your behalf, so your key reaches our server. The sections below spell out exactly what that means.

---

## The three ways you might be running the app

| Mode | Where your key lives at rest | Does your key reach the AI Triad server? |
|---|---|---|
| **Desktop app** (Electron) | Your operating system's secure credential store | **No** — the desktop app calls the AI provider directly |
| **Web app, signed in** | Encrypted server-side key store | **Yes** — saved to the server, encrypted at rest |
| **Web app, not signed in** ("bring your own key") | Your browser's per-tab `sessionStorage` | **Yes** — sent with each AI request; not stored on the server |

Everything below expands on these rows.

---

## Desktop app (strongest isolation)

If you run the Taxonomy Editor as an installed desktop application:

- Your key is stored using your **operating system's native secure storage**. Depending on your platform, that is the Windows Data Protection API (DPAPI), the macOS Keychain, or the Linux Secret Service (libsecret). It is encrypted with keys managed by your OS account.
- The key is written to an encrypted file inside the app's private user-data directory. It is **never stored in plain text**.
- When the app needs to call the AI provider, it does so **directly from your machine to the provider** (for example, to Google's Gemini endpoint). Your key does **not** pass through any AI Triad server.
- The raw key stays in the app's background process. The visible part of the app (the window you interact with) only ever receives a **masked** version of the key.

This is the mode with the least exposure: your key never leaves your computer except to go to the AI provider you chose.

---

## Web app

The web app works differently in one important way: **it uses the server as a proxy.** When you run an AI action, your browser asks the AI Triad server to make the provider call, and the server uses your key to do it. This design keeps provider credentials and quota logic on the server, but it means **your key reaches our server in the course of normal use.** What differs is whether the key is *stored* there.

### Signed in

- When you save a key, it is sent to the server over an encrypted (HTTPS/TLS) connection and stored in the server's **encrypted key store**:
  - **Self-hosted / local deployments:** the key is encrypted at rest with **AES-256-GCM** in a protected file, using a randomly generated 64-byte key material file with restrictive (owner-only) permissions.
  - **Managed cloud deployments:** the key is stored as a secret in **Azure Key Vault**, one secret per user and provider, with encryption and access managed by Key Vault. The server authenticates to the vault using a managed identity, and secret names are hashed so your identity is not exposed in them.
- The server **never writes your raw key to logs** and **never returns your full key** to the browser. Only a masked form, showing just the last few characters, is ever displayed.

**Honest caveat about the local (self-hosted) mode:** the encryption key material is stored on the same disk as the encrypted key file. This protects your key against someone who obtains a copy of the disk or a backup off the machine; it does **not** protect against someone who already has read access to the server's data directory. For managed cloud deployments, Azure Key Vault provides stronger separation.

### Not signed in ("bring your own key")

If you use the web app without an account and simply paste in your own key:

- Your key is kept only in your browser's **`sessionStorage`**. It is **not encrypted** there, and it is **not saved on the server**.
- `sessionStorage` is **per-tab and temporary**: the key is cleared automatically when you close the browser tab. It is not shared with other tabs, and it does not persist after the tab closes.
- On **each AI request**, your key is included in the request sent to the AI Triad server (over HTTPS/TLS), so the server can make the provider call on your behalf. The server uses it for that request and does not persist it.

This mode is convenient and keeps nothing on the server long-term, but be aware of the trade-off: the key is held unencrypted in your browser session, and it does travel to our server with each request (protected in transit by TLS).

---

## Sharing keys by QR code

The **Share / Import Keys via QR** feature lets you move keys between your own devices. It is designed so the key is never exposed in the QR image itself:

- Before the QR code is generated, your keys are **encrypted in your browser** using **AES-256-GCM** with a key derived from a **passphrase you choose** (PBKDF2, 100,000 iterations, SHA-256, with a random salt and initialization vector).
- The QR code contains **only the encrypted payload**, never the raw key itself. Without your passphrase, a photograph of the QR code cannot be turned back into your key.
- **Your passphrase is the whole protection.** Choose a strong one, share it separately from the QR image, and do not post the QR code publicly. Anyone who has both the image and the passphrase can recover the keys.

---

## What protects your key in transit

In all web interactions, your key is carried over an **encrypted HTTPS/TLS connection** between your browser and the server (and between the server and the AI provider). It is sent inside the request body; there is no additional application-level encryption layered on top of TLS for the key field. TLS is what prevents someone on the network from reading it in transit.

---

## Practical guidance for keeping your key safe

- **Scope and limit your key.** Where your provider allows it, create a key dedicated to this app, restrict what it can do, and set spending/quota limits. Then a leaked key has bounded impact.
- **Rotate if in doubt.** If you ever suspect exposure, revoke the key in your provider's console and issue a new one. This is the fastest, most reliable remedy for any key.
- **Prefer the desktop app for maximum isolation** if you want your key to never leave your machine except to reach the provider.
- **In the not-signed-in web mode, close the tab when you're done.** That clears the key from your browser session.
- **For QR sharing, use a strong passphrase** and transmit it through a different channel than the QR image.
- **Delete keys you no longer use** via Settings → API Keys; the app removes them from browser storage (and from the server store when you are signed in).

---

## Questions or concerns

If you have a security question about how your key is handled, or you believe a key may have been exposed, revoke the key with your provider first, then contact the project maintainers.

*This document describes the current behavior of the application and will be updated as the app evolves.*
