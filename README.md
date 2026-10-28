# oc-one-guard

An OpenCode plugin that checks proposed tool calls for possible data exfiltration. It is a heuristic guardrail - not a promise that every risky call will be caught.

## How Does It Work?

**Tool call → local checks → judge if needed → allow or block.**

- We look for risky transfers - e.g. uploading keys, dumping environment variables, or staging a script that sends files out.
- Ordinary local calls can skip the judge. Calls that need review go to your configured System One endpoint before execution.
- The model can miss things. I'd treat this as an extra check, not a firewall.

⚠️ **Judge offline? Reviewed calls block by default.** Unclear answers and escalations block too. Keep the [disable instructions](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/installation.md#disable-it-if-the-judge-is-offline) handy.

## Quick Heads-Up

- OpenCode v1 only. Version 1.19.4 is tested; v2 is not supported.
- Setup is opt-in. Cloning this repo does not register the plugin or change OpenCode configuration.
- The judge receives rendered tool arguments and, in some cases, staged file contents. Pick an endpoint you trust.

## Want the Picture?

Open `docs/explainer.html` from your checkout in a browser, or [download it](https://raw.githubusercontent.com/HumanFace-Tech/oc-one-guard/main/docs/explainer.html) and open the saved file. It covers the flow, examples, and limits without the configuration dump. GitHub shows HTML source, not a live page.

## Where to Go Next?

- [Install the plugin](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/installation.md)
- [Configure the guard](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/configuration.md)
- [Data handling and security limits](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/security.md)
- [Run tests and contribute](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/contributing.md)
- [Documentation index](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/docs/README.md)

## What's Next?

These are ideas, not current features: support for OpenCode v2, plus a simpler setup and calibration path that stays conservative by default. The current release supports v1 only.

MIT. See [LICENSE](LICENSE).
