# Security policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub's private vulnerability reporting, at
https://github.com/venus-uni-dev/venus-university/security/advisories/new

Do not open a public issue for a security problem.

When reporting, please include:

- what the vulnerability is and where it lives (a file path or a step to reproduce);
- what an attacker could do with it;
- your OS and app version, if relevant;
- any log lines or stack traces that help reproduce it (redact anything personal first).

## Scope

Venus University is a single-player desktop app that runs entirely on the player's own machine.
There is no server and no account system. Its network touchpoints are Google's Gemini API (which
writes the game's scenes), the player's own locally managed ComfyUI (which renders character
art), and, during first-time setup, the model and runtime files ComfyUI needs, fetched from GitHub
and Hugging Face. Reports about any of these integrations, about how the Gemini API key is stored,
or about how saved data is read or written, are the most relevant and the most welcome.
