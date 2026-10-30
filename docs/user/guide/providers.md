# Configure models

English | [中文](providers.zh.md)

This guide assumes you started the Web UI through the [root README](../../../README.md#run). Model changes take effect on the next request without restarting the server.

## Configure DeepSeek

Open **Settings → Models**. The DeepSeek card exposes one API-key field; enter the key and save it.

![The Models page: the DeepSeek card, with Add provider and Add a custom provider below it](providers-models-page.png)

Keys are write-only. The page receives a redacted descriptor after saving, never the literal secret. The key is stored in `$DSH_HOME/.credentials.yaml`, while settings retain only its credential reference.

With a key saved and the default endpoint, DeepSeek's models follow the list the DeepSeek API publishes. The list loads when the models are first needed, refreshes in the background about every ten minutes while they are in use, and falls back to the built-in models when it cannot load. Editing **Models** under **Customized settings** keeps your own list instead and stops following the published one; **Restore defaults** follows it again and reloads it. While the published list is in use, the card shows the built-in models, so a newly published model appears only in the model picker. The [API-key provider reference](../../../packages/llm/llm-deepseek-api-key/README.md) owns the listing, fallback, and gating rules.

## Add a third-party provider

Choose **Add provider** and pick a provider dsh ships with; the list shows provider ids such as `anthropic`, `openai`, `moonshotai` for Kimi, or `zai` for GLM. Enter its API key and save. The installed catalog supplies the endpoint, protocol, and model list.

The authentication **?** explains saved-credential priority and environment fallbacks. Leave the key blank to use a saved credential or try the listed environment variables. A green hint identifies a detected environment variable. A yellow hint means no credential variable was detected; enter an API key or configure the listed variable. An unconfirmed hint means the status read failed. Detection does not validate the credential or test the connection. Provider-managed credential files, including AWS profiles and Google application-default credentials, are outside this check. Providers without native key authentication, such as `openai-codex`, show no key field unless the profile explicitly names a credential reference.

A saved credential uses the placeholder **Leave blank to use saved credentials**, with no status text below the input. Environment fallback uses **Leave blank to use env as auth** and one detection hint while the input is empty. A nonempty input shows no authentication status text. Address configuration variables appear under **Base URL** and do not count as credentials.

A nonempty key input has an eye button. Select **Show secret** to check what you typed, and **Hide secret** to mask it again. Changing the input masks it again. Stored credentials remain write-only.

## Add a custom provider

Choose **Add a custom provider** for a company gateway, self-hosted server, or provider absent from the installed catalog. Supply a lowercase Provider ID, base URL, API protocol, credential, and at least one model. The **API protocol** must be the one your gateway speaks, and the form offers three: `openai-completions` for OpenAI Chat Completions, `openai-responses` for the OpenAI Responses API, and `anthropic-messages` for the Anthropic Messages API. A provider speaks one protocol, so a gateway that serves two needs two providers.

![The custom provider form: Provider ID, display name, base URL, API protocol, and API key](providers-custom-form.png)

The Provider ID is permanent because requests, saved sessions, model defaults, and credential references use it. To rename a provider, add a new provider and delete the old one. The display name, base URL, protocol, credential, and models remain editable.

### Discover models

Under **Model catalog**, choose **Fetch available models** to ask the endpoint which models it serves. The request uses the base URL, protocol, and key currently in the form, or a saved provider's stored key, and the reply opens a searchable picker: models already in the list start ticked, so search, tick the models to add, untick the ones to remove, and choose **Update list**. Configured models the endpoint does not list stay. Nothing is stored until you save or create the provider.

Discovery reads the listing formats common gateways publish, but not every endpoint answers in one of them, so treat it as a convenience rather than a guarantee: when it fails or lists nothing, add the model ids by hand and they work just the same. A built-in provider is always answered from the installed catalog, even when its base URL points at a gateway, so fetch through a custom provider to see what the gateway really serves.

## Select a model

Configured providers appear in the model picker. Selecting a model also makes it the default for new sessions. A session that has already sent a request retains the model recorded in its own log.

To change a provider’s model order, edit it in **Settings → Models**, open **Customized settings**, and drag a model’s three-line handle. You can also focus the handle and press the up or down arrow key. **Apply** keeps the order; **Cancel** discards it. The model picker follows the saved order within that provider.

If a saved default names a provider that was deleted, the composer displays **Select model** and blocks input until another model is selected.

## Advanced configuration

The generated [plugin configuration catalog](../../config-catalog.md) lists every supported field and default for every plugin; [`dsh-llm-pi-ai`](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) is the provider section this page configures. The [`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) and [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) references own direct `settings.yaml` configuration, catalog resolution, reasoning controls, credentials, and adapter errors.

::: tip Additional settings
The Models page exposes the API key, display name, base URL, API protocol, and each model's id, display name, context window, max output tokens, and input types, plus the reasoning levels of a model on a custom model API provider. Configure the reasoning levels of a built-in provider's models, request-compatibility switches, headers, timeouts, and retry policy in `$CLH_HOME/profiles/<profile>/cordis.patch.yml`, the same document the page writes. Edit it directly, or, when the browser runs on the same machine as the server, open it with **Open configuration file** in the Settings header; the adapters re-read it on the next request, so nothing needs a restart. The subsections below cover the fields most gateways need.

For the standard Web UI launch with `clh web`, `<profile>` is `web`, so the path is `$CLH_HOME/profiles/web/cordis.patch.yml`. If you launch a custom profile, use the name selected at startup instead.
:::

### Image input

A model you enter by hand is treated as text-only until it says otherwise, because nothing can ask an endpoint which modalities it accepts. Attaching an image to such a model is refused before it is sent, naming the model.

A vision model on a custom provider therefore needs one line. The form has no field for it; add `input` to the model in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` accepts `text` and `image`, and applies to that model alone, so one route can serve both kinds. Omitting it — or writing an empty list, which means the same thing — keeps whatever the installed catalog records for that model, and falls back to the route's `defaultInput` for a model the catalog does not describe.

If every model you entered by hand takes images, set the fallback once on the route instead of on each of them:

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` is a fallback, not an override, and defaults to `[text]`: on a built-in provider it answers only for models its catalog does not describe, so it never removes images from a catalog model that has them. Narrow one of those with that model's own `input`. A built-in provider has no `models` list to put it in, so write it under `modelOverrides`, keyed by model id:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

Every list must name at least one modality except a model's own, where an empty list means the same as omitting it. An unknown modality is refused wherever it is written.

Both fields state a claim about your endpoint rather than checking it. A model that declares images its endpoint does not serve is not caught here; the provider rejects the request instead.

### DeepSeek account models

A signed-in DeepSeek account lists its models from the account service, so the Models page offers no model editor for it. Adjust a single model with `modelOverrides` in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`; the fields match a DeepSeek `models` entry, and unset fields keep the listed values:

```yaml
- id: llm-deepseek-account
  config:
    modelOverrides:
      deepseek-flash:
        contextWindow: 524288
        maxTokens: 131072
```

A model that needs a newer DeepSeek Harness fails with `CLIENT_UPGRADE_REQUIRED`, which names the version to install. The [account provider reference](../../../packages/llm/llm-deepseek-account/README.md) owns the listing, fallback, and gating rules.

### Reasoning effort

The model picker offers an **Effort** menu for a model that declares reasoning levels. A built-in provider's models inherit their levels from the installed catalog, and DeepSeek's models keep the adapter's levels. A model you enter by hand declares none until you add them, so until then the Effort entry does not appear in the menu and the endpoint's own default decides whether the model thinks.

On a custom model API provider, declare the levels in **Settings → Models**: edit the provider, open **Customized settings**, expand the model's **Model options**, and turn on **Reasoning levels**. The rows start with off, low, medium, and high. Each row pairs a level with the **API value** sent for it, which defaults to the level name; change it only where the model provider's API documentation spells the level differently. Add or delete rows to match what the endpoint supports, keep at least one level besides off, and save. Turning the switch off removes the declaration.

The page writes `reasoningEfforts` in `$CLH_HOME/profiles/<profile>/cordis.patch.yml`, where you can also declare the levels directly:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      reasoning: high
      models:
        - id: my-reasoner
          reasoningEfforts:
            off:
            high: high
            max: max
```

Each key is a level the menu offers, and its value is the spelling sent on the wire as `reasoning_effort`, so `max: xhigh` renames a level for a gateway with its own vocabulary. Only `off` may stay empty, because for most endpoints not thinking is the parameter's absence. The route's `reasoning` is the level used while a session has picked none; choosing an effort in the picker saves it, with the model, as the default for new sessions.

An `off` left empty sends nothing, which only stops a model that thinks on request; an `off` given a value sends that value as `reasoning_effort` instead. A model that thinks unless told not to — DeepSeek V4 behind an OpenAI-compatible gateway, for example — needs `compat.thinkingFormat: deepseek`, which makes `off` send `thinking: {type: disabled}` and every other level send `thinking: {type: enabled}` beside the effort:

```yaml
      models:
        - id: deepseek-v4-pro
          compat:
            thinkingFormat: deepseek
          reasoningEfforts:
            off:
            high: high
            max: max
```

A built-in provider's model whose gateway does not reason loses its levels with `reasoningEfforts: false` under `modelOverrides`; selecting an effort for it is then refused as `UNSUPPORTED_REASONING_EFFORT`. DeepSeek's own route needs none of this: its models already offer `off`, `low`, `high`, and `max`, and `llm-deepseek.reasoningEffort` sets the default the picker starts from:

```yaml
llm-deepseek:
  reasoningEffort: max
```

### Request compatibility

A gateway can hold a working key at a reachable address and still refuse every request. pi-ai decides the shape of a request — which role carries the system prompt, which field caps the output, how a thinking level travels — from the endpoint's URL, and an address it does not recognize is addressed as though it were OpenAI itself. Most OpenAI-compatible gateways refuse at least one thing OpenAI accepts.

Two account for most of it. A model that declares reasoning has its system prompt sent as `role: "developer"`, which many gateways reject outright, and the output cap is sent as `max_completion_tokens`, which a server that only knows `max_tokens` refuses. The form has no field for either; correct them on the route in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

A route's `compat` is the default for its models, and a model's own wins field by field, so one model can be corrected without restating the route:

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

What neither sets keeps the installed catalog's value for that model, and what the catalog does not describe falls to pi-ai's detection. Give every switch you name a value: a key left empty (`supportsDeveloperRole:`) is refused rather than ignored, because an empty value would erase what the catalog knows while saying nothing in its place. A name no protocol accepts is refused too, and the message lists the ones that are available.

Each switch belongs to the protocols that declare it, so a switch valid on one `api` may be refused on another — the message names what that protocol does offer. Like `input` above, a switch states a claim about your endpoint rather than checking it: setting one your gateway does not actually need simply sends a different request.

Every switch, its accepted values, and the protocols that take it are listed under `PiAiCompatProfile` in the [generated `dsh-llm-pi-ai` configuration reference](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) — which is derived from the source, so it cannot fall behind what the adapter accepts.

## Troubleshooting

- **`MISSING_CREDENTIAL`** — Store the provider key through the Models page or supply the referenced environment variable.
- **`UNKNOWN_MODEL`** — Select a configured model or add the missing model to the custom provider.
- **Fetching available models returns 401** — Check the key. Model discovery calls the OpenAI-compatible `GET /models` endpoint; enter models manually for endpoints that do not provide it.
- **Fetching available models reports neither a `data` array nor a `models` object** — The endpoint's listing is in a format discovery does not read. Enter the models by hand.
- **The gateway refuses every request although the key and URL are right** — Its request shape differs from OpenAI's. Start with `compat.supportsDeveloperRole: false` and `compat.maxTokensField: max_tokens` on the route.
- **Only reasoning models fail** — pi-ai sends their system prompt as the `developer` role, which the gateway rejects. Set `compat.supportsDeveloperRole: false`.
- **The Effort menu does not appear for a model you entered by hand** — It declares no levels. On a custom model API provider, turn on **Reasoning levels** in the model's **Model options**; elsewhere, add `reasoningEfforts` to the model in `cordis.patch.yml`.
- **`off` does not stop a DeepSeek model from thinking** — An empty `off` sends no reasoning field at all, and an endpoint that thinks by default keeps thinking. Set `compat.thinkingFormat: deepseek` on the model or the route.
- **A compat switch is refused as having no value** — A key written with nothing after the colon. Give it a value, or remove the key to keep the installed catalog's.
- **An image is refused before sending** — The model declares no image modality. Give a custom provider's model `input: [text, image]`; on DeepSeek's own route, select `deepseek-v4-flash-vision-exp`, the model that declares images.
- **The provider rejects a request carrying an image** — The model declares images its endpoint does not actually serve. Remove `image` from whichever list granted it — the model's `input`, or the route's `defaultInput` — then start a new session: the attached image stays in the session log, so the same request repeats until the session moves off it.
