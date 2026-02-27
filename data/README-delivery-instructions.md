# Delivery instructions JSON format

Place one JSON file with all delivery instructions and load it in the app via **Home → Delivery Instructions → Load from JSON file**. Instructions are auto-matched to route stops by address during export.

## Format

```json
{
  "instructions": [
    {
      "address": "123 Main",
      "title": "Gate Code",
      "details": "1234#"
    },
    {
      "address": "456 Oak",
      "title": "Use Back Door",
      "details": "Rear entrance"
    }
  ]
}
```

- **address** (required): Address or label used to match this instruction to a route stop. Matching is fuzzy (case-insensitive, punctuation ignored).
- **title** (required): Short label (e.g. "Gate Code", "Use Back Door").
- **details** (required): Full instruction text.
- **id** (optional): Optional unique identifier.
- **priority** (optional): `"critical"` | `"high"` | `"medium"` | `"low"`.

The default file used at startup is `deliveryInstructions.json` in this folder. Replace it or load your own file in the app to set instructions.
