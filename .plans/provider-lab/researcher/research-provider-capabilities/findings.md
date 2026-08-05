# research-provider-capabilities Findings

Status: complete

## Sources

- OpenAI Models API: https://developers.openai.com/api/reference/resources/models/methods/list/
- OpenAI images and vision guide: https://developers.openai.com/api/docs/guides/images-vision
- OpenRouter Models API: https://openrouter.ai/docs/api/api-reference/models/get-models
- OpenRouter model filters and schema: https://openrouter.ai/docs/guides/overview/models
- LiteLLM vision support: https://docs.litellm.ai/docs/completion/vision
- LiteLLM model info endpoint: https://docs.litellm.ai/docs/proxy/model_management
- LiteLLM supported params / JSON mode: https://docs.litellm.ai/docs/completion/json_mode
- LiteLLM model discovery: https://docs.litellm.ai/docs/proxy/model_discovery
- vLLM OpenAI-compatible server: https://docs.vllm.ai/en/latest/getting_started/quickstart/
- vLLM structured outputs: https://docs.vllm.ai/en/stable/features/structured_outputs/
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Ollama vision: https://docs.ollama.com/capabilities/vision
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- LM Studio OpenAI compatibility: https://lmstudio.ai/docs/developer/openai-compat
- LM Studio structured output: https://lmstudio.ai/docs/developer/openai-compat/structured-output
- LM Studio native model list: https://lmstudio.ai/docs/developer/rest/list

## Conclusions

### Minimum OpenAI-compatible provider profile fields

Provider Lab v1 should store only non-secret metadata in SQLite and keep secrets in keytar. Minimum fields:

- `id`: local UUID.
- `displayName`: user-visible name.
- `providerKind`: enum such as `openai-compatible`, `openrouter`, `litellm`, `vllm`, `ollama`, `lmstudio`, `custom`.
- `baseUrl`: normalized base URL ending at API root, usually `/v1`.
- `authType`: `bearer`, `none`, or `customHeader`.
- `secretRef`: keytar lookup key only; never the secret value.
- `defaultModelId`: optional model id selected by user.
- `modelsPath`: default `/models`; allow override for non-standard gateways.
- `chatPath`: default `/chat/completions`; allow override later if Responses API is adopted.
- `enabled`: boolean.
- `createdAt`, `updatedAt`, `lastValidatedAt`.
- `notes` or `metadata`: optional user notes, non-secret.

Do not store API keys, Pixiv cookies, Authorization headers, raw request bodies with images, or provider debug payloads in plaintext.

### `/v1/models` response formats and differences

OpenAI's canonical list response is intentionally minimal: `{ object: "list", data: [{ id, created, object: "model", owned_by }] }`. It does not expose vision, JSON, streaming, or safety/adult-input capability flags.

OpenRouter extends model objects with useful fields: `architecture.input_modalities`, `architecture.output_modalities`, `context_length`, `pricing`, `supported_parameters`, and `top_provider.is_moderated`. These fields can seed capability records. An unmoderated route is positive provider-policy evidence for adult routing but does not guarantee the base model's output behavior; a moderated route remains indeterminate unless more specific capability fields are present.

LiteLLM has two relevant surfaces. `/v1/models` can discover configured or wildcard models, while `/model/info` returns richer configured metadata and model cost-map fields. LiteLLM SDK helpers include `supports_vision`, `supports_response_schema`, and `get_supported_openai_params`; for a local app calling a proxy, the backend should prefer `/model/info` when available and fall back to active tests.

vLLM exposes an OpenAI-compatible server with `/v1/models`, chat/completions, and other endpoints. The server may host one configured model at a time in common setups. Capability discovery from `/v1/models` is weak; use vLLM supported-model docs, launch config, and active probes. Structured outputs are supported by server-side structured output options, but this should still be verified per served model.

Ollama exposes partial OpenAI compatibility and native APIs. Vision is model-dependent and native requests use an `images` array. Structured output is available through `format: "json"` or a JSON schema in native APIs; OpenAI-compatible behavior should be tested because compatibility is partial and can change.

LM Studio exposes OpenAI-compatible endpoints for local models and a native `/api/v1/models` endpoint that lists local models with type metadata. Structured JSON output is supported through `/v1/chat/completions` with a JSON schema. Vision remains model-dependent and should be tested against the loaded model.

### Capability discovery by provider

| Provider | Vision discovery | Streaming discovery | JSON/structured discovery | Notes |
|---|---|---|---|---|
| OpenAI-compatible generic | Active image probe only | Active `stream: true` probe | Active `response_format` probe | `/v1/models` usually insufficient. |
| OpenRouter | `architecture.input_modalities` includes image | `supported_parameters` may include stream-related params; still probe | `supported_parameters` may include `response_format`, `structured_outputs`, or tool-related params | Good metadata seed, not a full safety contract. |
| LiteLLM | `/model/info.model_info.supports_vision` or SDK `supports_vision` | `get_supported_openai_params` includes `stream` | `supports_response_schema` or `response_format` in supported params | Config and cost-map can be stale; active test still needed. |
| vLLM | Served model architecture/docs plus active image probe | OpenAI-compatible streaming probe | Structured output probe with server-supported schema options | Server config matters as much as model family. |
| Ollama | Native model family knowledge plus active image probe using image content | Native/OpenAI stream probe | Native `format` JSON/schema probe; OpenAI-compatible probe separately | Local, no third-party secret risk, but model capability varies. |
| LM Studio | Native model list plus active image probe | OpenAI-compatible stream probe | `/v1/chat/completions` schema probe | Loaded model and runtime version matter. |

## Recommended `ModelCapability` fields

Use tri-state capability values so unknown does not accidentally pass routing checks.

```ts
type CapabilityState = "supported" | "unsupported" | "unknown";
type CapabilitySource = "provider_metadata" | "active_test" | "user_confirmed" | "manual_override";

interface ModelCapability {
  id: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  providerKind: string;
  sourceModelObject?: unknown; // redacted, no secrets, optional debug-only storage

  inputModalities: {
    text: CapabilityState;
    image: CapabilityState;
    audio?: CapabilityState;
    pdf?: CapabilityState;
  };
  outputModalities: {
    text: CapabilityState;
    image?: CapabilityState;
    audio?: CapabilityState;
  };

  supportsChat: CapabilityState;
  supportsStreaming: CapabilityState;
  supportsJsonMode: CapabilityState;
  supportsJsonSchema: CapabilityState;
  supportsToolCalling?: CapabilityState;
  supportsSystemMessages?: CapabilityState;

  contextWindowTokens?: number;
  maxOutputTokens?: number;
  pricing?: {
    inputPerToken?: string;
    outputPerToken?: string;
    imageInput?: string;
    request?: string;
    currency?: string;
  };

  safety: {
    providerModerated: CapabilityState;
    adultTextInput: CapabilityState;
    adultImageInput: CapabilityState;
    explicitImageInput: CapabilityState;
    minorSafetyPolicyKnown: CapabilityState;
    requiresLocalOnlyForExplicit: boolean;
  };

  tests: {
    text?: CapabilityTestResult;
    vision?: CapabilityTestResult;
    streaming?: CapabilityTestResult;
    jsonMode?: CapabilityTestResult;
    jsonSchema?: CapabilityTestResult;
  };

  discoveredAt?: string;
  testedAt?: string;
  confirmedAt?: string;
  capabilitySource: CapabilitySource;
}
```

Recommended test result shape:

```ts
interface CapabilityTestResult {
  status: "pass" | "fail" | "skipped";
  checkedAt: string;
  latencyMs?: number;
  errorCode?: string;
  redactedMessage?: string;
}
```

## Risks

- Do not infer capability solely from model names like `vision`, `vl`, `gpt`, or `llava`; names are inconsistent and gateways can alias models.
- Treat OpenRouter `top_provider.is_moderated=false` only as positive provider-policy evidence, not as a guarantee of model behavior. Do not turn `true` into a blanket adult-content denial.
- Do not treat LiteLLM cost-map metadata as authoritative forever; docs note model metadata is pulled from config and model maps, and active routing can bridge endpoints.
- Do not let unknown equal supported. Unknown must fail closed for image and R-18 routes.
- Local endpoints can still leak content if `baseUrl` points to a remote host. Classify `isLocalProvider` by user setting plus URL checks, not by provider kind alone.

## Recommendation

Provider Lab v1 should combine three layers:

1. Parse provider metadata where available.
2. Run backend-only active probes for text, vision, streaming, JSON mode, and JSON schema.
3. Require user confirmation for adult text/image support before any explicit image route can pass.

The UI should display provenance: "provider metadata", "tested", or "user confirmed". Routing should only trust `active_test` or `user_confirmed` for risky capabilities.
