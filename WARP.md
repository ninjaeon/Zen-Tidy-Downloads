# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Repo purpose
- A Firefox/Zen userChrome script (tidy-downloads.uc.js) plus CSS (chrome.css) that enhances the downloads UX with optional AI-powered file renaming. It is distributed for Sine and can also be installed manually into a browser profile.
- There is no Node/Make/NPM build, no linter, and no test suite in this repo.

Common workflows and commands (Windows, PowerShell)
- Install locally into a Firefox/Zen profile for development
  1) Identify your profile path from about:profiles (Root Directory), or let the snippet prompt you.
  2) Copy the JS and CSS into both candidate folders used by the script’s CSS gate.

  ```powershell path=null start=null
  # Detect default Firefox profile from profiles.ini (falls back to manual prompt)
  function Get-FFProfilePath {
    $ini = Join-Path $env:APPDATA 'Mozilla\Firefox\profiles.ini'
    if (-not (Test-Path $ini)) { return $null }
    $section = $null; $default = $null
    foreach ($line in Get-Content -Path $ini) {
      if ($line -match '^\[Profile') { $section = @{}; continue }
      if ($line -match '^Name=') { $section.Name = $line.Split('=')[1] }
      if ($line -match '^Path=') { $section.Path = $line.Split('=')[1] }
      if ($line -match '^Default=1') { $default = $section }
    }
    if ($default -and $default.Path) {
      $root = if ($default.Path -match '^\w:') { $default.Path } else { Join-Path (Join-Path $env:APPDATA 'Mozilla\Firefox') $default.Path }
      return $root
    }
    return $null
  }

  $ffProfile = Get-FFProfilePath
  if (-not $ffProfile) {
    Write-Host 'Could not auto-detect profile. Open about:profiles, copy a Root Directory path, and paste it below.'
    $ffProfile = Read-Host 'Profile path'
  }

  if (-not $ffProfile) { throw 'No profile path provided' }

  # Candidate subpaths the script checks for chrome.css
  $candidates = @(
    'chrome\zen-themes\zen-tidy-downloads',
    'chrome\sine-mods\zen-tidy-downloads'
  )

  $repo = "$PWD"  # assumes running in this repo
  $srcCss = Join-Path $repo 'chrome.css'
  $srcJs  = Join-Path $repo 'tidy-downloads.uc.js'

  foreach ($rel in $candidates) {
    $dst = Join-Path $ffProfile $rel
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Force -Path $srcCss -Destination (Join-Path $dst 'chrome.css')
    Copy-Item -Force -Path $srcJs  -Destination (Join-Path $dst 'tidy-downloads.uc.js')
    Write-Host "Installed to $dst"
  }

  Write-Host 'Restart the browser. If changes do not apply, visit about:support and click "Clear startup cache".'
  ```

- Quick toggles for development (about:config)
  These preference keys are read by the script. Set them in about:config as needed during dev:
  - extensions.downloads.enable_ai_renaming: master toggle for AI renaming (default true)
  - extensions.downloads.enable_debug: enable debug logs in the Browser Console
  - extensions.downloads.debug_ai_only: filter logs to AI-related messages
  - extensions.downloads.skip_css_check: bypass CSS presence gate (useful if testing CSS placement)
  - Provider toggles and keys (enable + api_key + optional endpoint/model):
    - Mistral: extensions.downloads.mistral_enabled, extensions.downloads.mistral_api_key, extensions.downloads.mistral_model, extensions.downloads.mistral_api_url
    - OpenAI: extensions.downloads.openai_enabled, extensions.downloads.openai_api_key, extensions.downloads.openai_model, extensions.downloads.openai_api_url
    - OpenRouter: extensions.downloads.openrouter_enabled, extensions.downloads.openrouter_api_key, extensions.downloads.openrouter_model, extensions.downloads.openrouter_api_url
    - Anthropic: extensions.downloads.anthropic_enabled, extensions.downloads.anthropic_api_key, extensions.downloads.anthropic_model, extensions.downloads.anthropic_api_url, extensions.downloads.anthropic_version
    - Gemini: extensions.downloads.gemini_enabled, extensions.downloads.gemini_api_key, extensions.downloads.gemini_model, extensions.downloads.gemini_api_url
    - DeepSeek: extensions.downloads.deepseek_enabled, extensions.downloads.deepseek_api_key, extensions.downloads.deepseek_model, extensions.downloads.deepseek_api_url
    - Ollama (local): extensions.downloads.ollama_enabled, extensions.downloads.ollama_model, extensions.downloads.ollama_endpoint
  - Other useful knobs:
    - extensions.downloads.progress_update_throttle_ms
    - extensions.downloads.show_old_downloads_hours
    - extensions.downloads.max_filename_length
    - extensions.downloads.max_file_size_for_ai
    - extensions.downloads.ai_call_timeout_ms
    - extensions.downloads.auto_dismiss_previous_on_new
    - extensions.downloads.stable_focus_mode

Sine install (from README)
- In Sine settings, enable installing JS from unofficial sources.
- Add a mod by repository using: https://github.com/ninjaeon/Zen-Tidy-Downloads/tree/all-api
- After install, configure mod settings (API keys and preferences as above).
- If changes don’t appear, visit about:support and click Clear startup cache, then restart.

Architecture overview (big picture)
- Startup gating and window checks
  - Script runs only in the main browser window (browser.xhtml), with multiple popup/exclusion checks.
  - A CSS presence gate (checkCSSAvailability + waitForCSSWithRetries) verifies chrome.css is loaded from one of two candidate profile folders:
    - <profile>\chrome\zen-themes\zen-tidy-downloads\chrome.css
    - <profile>\chrome\sine-mods\zen-tidy-downloads\chrome.css
  - If CSS is missing, initialization is deferred with a late-activation watcher; the gate can be bypassed via extensions.downloads.skip_css_check.

- UI composition
  - Root container: #userchrome-download-cards-container
  - Master tooltip: .details-tooltip.master-tooltip (status/title/size/undo/dismiss)
  - Pods row: #userchrome-pods-row-container with .download-pod elements (image preview or moz-icon fallback)
  - chrome.css defines layout, z-index, animations, and interactive states; tooltip width can sync to Zen sidebar width.

- Downloads integration
  - Hooks window.Downloads list (ALL) with add/change/remove handlers.
  - Maintains activeDownloadCards (Map) and orderedPodKeys; throttles update frequency; optional auto-dismiss of previous pods on new download.
  - Provides a right-click context menu (open file, Show All Downloads, dismiss).

- Dismissed pile and event API
  - Tracks dismissed items and exposes window.zenTidyDownloads:
    - onPodDismissed / offPodDismissed (subscribe), dismissedPods.getAll/get/count/clear
    - onActualDownloadRemoved / offActualDownloadRemoved
    - restorePod(podKey), permanentDelete(podKey)
  - Minimal in-page UI to view/restore/remove dismissed downloads.

- AI rename pipeline
  - Provider selection via getActiveAIProvider based on prefs; supports mistral, openai, openrouter, anthropic, gemini, deepseek, ollama.
  - On completion, builds a prompt; for images, optionally attaches base64 content.
  - Enforces timeout/abort; sanitizes and truncates names; ensures uniqueness on disk; renames via nsIFile; updates download object and UI; records info for undo.
  - Undo rename is supported and migrates internal keys/state.

- Zen integrations
  - Sidebar width sync reads --zen-sidebar-width and applies it to tooltip width.

- Packaging/metadata
  - theme.json provides metadata and remote asset URLs pinned to branch all-api; preferences.json defines Sine settings UI.

Notes
- No WARP.md existed prior to this addition.
- No CLAUDE.md, Cursor rules, or Copilot instructions were found in this repo.
