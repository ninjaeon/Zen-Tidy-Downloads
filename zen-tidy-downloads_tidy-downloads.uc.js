// ==UserScript==
// @include   main
// @loadOrder    99999999999999
// @ignorecache
// ==/UserScript==

// userChrome.js / download_preview_mistral_pixtral_rename.uc.js - FINAL FIXED VERSION
// AI-powered download preview and renaming with Mistral vision API support
(function () {
  "use strict";

  // Visible runtime version banner for console verification
  const ZEN_TIDY_VERSION = '2.0.3';

  // Use Components for Firefox compatibility
  const { classes: Cc, interfaces: Ci } = Components;

  // Wait for browser window to be ready
  if (location.href !== "chrome://browser/content/browser.xhtml") return;

  // === POPUP WINDOW EXCLUSION CHECKS ===
  // Method 1: Check window type attribute
  if (document.documentElement.getAttribute('windowtype') !== 'navigator:browser') {
    console.log('Zen Tidy Downloads: Skipping - not a main browser window (windowtype check)');
    return;
  }

  // Method 2: Check if this is a popup by examining window features
  try {
    // Check if window has minimal UI (characteristic of popups)
    if (window.toolbar && !window.toolbar.visible) {
      console.log('Zen Tidy Downloads: Skipping - appears to be a popup (toolbar check)');
      return;
    }
    
    // Check window opener (popups usually have an opener)
    if (window.opener) {
      console.log('Zen Tidy Downloads: Skipping - window has opener (popup check)');
      return;
    }
  } catch (e) {
    // If we can't check these properties, continue but log it
    console.log('Zen Tidy Downloads: Could not check window properties:', e);
  }

  // Method 3: Check for essential browser UI elements that should exist in main window
  // Wait a bit for DOM to be ready, then check for main browser elements
  setTimeout(() => {
    const mainBrowserElements = [
      '#navigator-toolbox',  // Main toolbar container
      '#browser',            // Browser element
      '#sidebar-box'         // Sidebar container
    ];
    
    const missingElements = mainBrowserElements.filter(selector => !document.querySelector(selector));
    
    if (missingElements.length > 0) {
      console.log('Zen Tidy Downloads: Skipping - missing main browser elements:', missingElements);
      return;
    }
    
    // Method 4: Check window size (popups are usually smaller)
    if (window.outerWidth < 400 || window.outerHeight < 300) {
      console.log('Zen Tidy Downloads: Skipping - window too small (likely popup)');
      return;
    }
    
    // Method 5: Check for dialog-specific attributes
    if (document.documentElement.hasAttribute('dlgtype')) {
      console.log('Zen Tidy Downloads: Skipping - dialog window detected');
      return;
    }
    
    // If all checks pass, continue with initialization
    console.log(`Zen Tidy Downloads ${ZEN_TIDY_VERSION}: All popup exclusion checks passed, proceeding with initialization`);
    
    // === MAIN SCRIPT INITIALIZATION CONTINUES HERE ===
    // The rest of the script now runs within this setTimeout
    initializeMainScript();
  }, 100); // Small delay to ensure DOM elements are loaded

  // === MAIN SCRIPT FUNCTIONS ===
  function initializeMainScript() {
    // --- Configuration via Firefox Preferences ---
    // Available preferences (set in about:config):
    // extensions.downloads.mistral_api_key - Your Mistral API key (required for AI renaming)
    // extensions.downloads.mistral_enabled - Enable Mistral AI provider (default: false)
    // extensions.downloads.enable_debug - Enable debug logging (default: false)
    // extensions.downloads.debug_ai_only - Only log AI-related messages (default: true)
    // extensions.downloads.enable_ai_renaming - Enable AI-powered file renaming (default: true)
    // extensions.downloads.disable_autohide - Disable automatic hiding of completed downloads (default: false)
    // extensions.downloads.autohide_delay_ms - Delay before auto-hiding completed downloads (default: 20000)
    // extensions.downloads.interaction_grace_period_ms - Grace period after user interaction (default: 5000)
    // extensions.downloads.max_filename_length - Maximum length for AI-generated filenames (default: 70)
    // extensions.downloads.skip_css_check - Skip CSS availability check (default: false) - USE ONLY FOR DEBUGGING
    // extensions.downloads.max_file_size_for_ai - Maximum file size for AI processing in bytes (default: 52428800 = 50MB)
    // extensions.downloads.mistral_api_url - Mistral API endpoint (default: "https://api.mistral.ai/v1/chat/completions")
    // extensions.downloads.mistral_model - Mistral model to use (default: "mistral-small-latest")
    // extensions.downloads.anthropic_model - Anthropic model to use (default: "claude-3-5-haiku-latest")
    // extensions.downloads.gemini_model - Gemini model to use (default: "gemini-2.5-flash-lite")
    // extensions.downloads.stable_focus_mode - Prevent focus switching during multiple downloads (default: true)
    // extensions.downloads.progress_update_throttle_ms - Throttle delay for in-progress download updates (default: 500)
    // extensions.downloads.show_old_downloads_hours - How many hours back to show old completed downloads on startup (default: 2)

    // Legacy constants for compatibility
    const MISTRAL_API_KEY_PREF = "extensions.downloads.mistral_api_key";
    const DISABLE_AUTOHIDE_PREF = "extensions.downloads.disable_autohide";
    const IMAGE_LOAD_ERROR_ICON = "🚫";
    const TEMP_LOADER_ICON = "⏳";
    const RENAMED_SUCCESS_ICON = "✓";
    const IMAGE_EXTENSIONS = new Set([
      ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif",
      ".ico", ".tif", ".tiff", ".jfif"
    ]);


    // Platform-agnostic path separator detection
    const PATH_SEPARATOR = navigator.platform.includes("Win") ? "\\" : "/";

    // Global state variables
    let downloadCardsContainer;
    const activeDownloadCards = new Map();
    let renamedFiles = new Set();
    let aiRenamingPossible = false;
    let cardUpdateThrottle = new Map(); // Prevent rapid updates
    let currentZenSidebarWidth = '';
    let podsRowContainerElement = null; // Renamed back from podsStackContainerElement
    let masterTooltipDOMElement = null;
    let focusedDownloadKey = null;
    let orderedPodKeys = []; // Newest will be at the end
    let lastRotationDirection = null; // Track rotation direction: 'forward', 'backward', or null
    const dismissedDownloads = new Set(); // Track downloads that have been manually dismissed or auto-hidden
    const imagePreviewRetryState = new Map(); // key -> retryCount
    
    // AI Process Management
    const activeAIProcesses = new Map(); // downloadKey -> { abortController, processState, startTime }
    
    // CSS availability flag
    let cssStylesAvailable = false;

    // Event listeners for external scripts
    const actualDownloadRemovedEventListeners = new Set();

    // --- Dismissed Pods Management System ---
    const dismissedPodsData = new Map(); // Store dismissed pod data for pile feature
    const dismissEventListeners = new Set(); // Callbacks for pod dismiss events
    
    // Global API for dismissed pods pile feature
    window.zenTidyDownloads = {
      // Event system
      onPodDismissed: (callback) => {
        if (typeof callback === 'function') {
          dismissEventListeners.add(callback);
          debugLog('[API] Registered pod dismiss listener');
        }
      },
      
      offPodDismissed: (callback) => {
        dismissEventListeners.delete(callback);
        debugLog('[API] Unregistered pod dismiss listener');
      },
      
      // Dismissed pods access
      dismissedPods: {
        getAll: () => new Map(dismissedPodsData), // Return copy to prevent external modification
        get: (key) => dismissedPodsData.get(key),
        count: () => dismissedPodsData.size,
        clear: () => {
          dismissedPodsData.clear();
          debugLog('[API] Cleared all dismissed pods data');
        }
      },
      
      // Active downloads access (for pile script to check if hover should be disabled)
      get activeDownloadCards() {
        return activeDownloadCards;
      },

      // Event for when a download is actually removed from Firefox's list
      onActualDownloadRemoved: (callback) => {
        if (typeof callback === 'function') {
          actualDownloadRemovedEventListeners.add(callback);
          debugLog('[API] Registered actual download removed listener');
        }
      },

      offActualDownloadRemoved: (callback) => {
        actualDownloadRemovedEventListeners.delete(callback);
        debugLog('[API] Unregistered actual download removed listener');
      },
      
      // Pod restoration
      restorePod: async (podKey) => {
        debugLog(`[API] Restore pod requested: ${podKey}`);
        const dismissedData = dismissedPodsData.get(podKey);
        if (!dismissedData) {
          debugLog(`[API] Cannot restore pod - no dismissed data found: ${podKey}`);
          return false;
        }
        
        try {
          // Remove from dismissed sets
          dismissedDownloads.delete(podKey);
          dismissedPodsData.delete(podKey);
          
          // If the download still exists in Firefox, recreate the pod
          const list = await window.Downloads.getList(window.Downloads.ALL);
          const downloads = await list.getAll();
          const download = downloads.find(dl => getDownloadKey(dl) === podKey);
          
          if (download) {
            debugLog(`[API] Found download for restoration: ${podKey}`);
            // Recreate the pod by calling our existing function
            throttledCreateOrUpdateCard(download, true);
            
            // Fire restore event
            fireCustomEvent('pod-restored-from-pile', { podKey, download });
            return true;
          } else {
            debugLog(`[API] Download no longer exists in Firefox for restoration: ${podKey}`);
            return false;
          }
        } catch (error) {
          debugLog(`[API] Error restoring pod ${podKey}:`, error);
          return false;
        }
      },
      
      // Permanent deletion
      permanentDelete: (podKey) => {
        debugLog(`[API] Permanent delete requested: ${podKey}`);
        const wasPresent = dismissedPodsData.delete(podKey);
        dismissedDownloads.add(podKey); // Ensure it stays dismissed
        
        if (wasPresent) {
          fireCustomEvent('pod-permanently-deleted', { podKey });
        }
        
        return wasPresent;
      }
    };
    
    // Helper function to fire custom events
    function fireCustomEvent(eventName, detail) {
      try {
        const event = new CustomEvent(eventName, { 
          detail, 
          bubbles: true, 
          cancelable: true 
        });
        document.dispatchEvent(event);
        debugLog(`[Events] Fired custom event: ${eventName}`, detail);
      } catch (error) {
        debugLog(`[Events] Error firing custom event ${eventName}:`, error);
      }
    }

    // Wait for CSS to be fully loaded with retries
    async function waitForCSSWithRetries(retries = 5, delayMs = 400) {
      try {
        for (let attempt = 0; attempt <= retries; attempt++) {
          const ok = checkCSSAvailability();
          if (ok) return true;
          // small delay before next attempt
          await new Promise(r => setTimeout(r, delayMs));
        }
        return false;
      } catch (e) {
        console.error('Error in waitForCSSWithRetries:', e);
        return false;
      }
    }
    
    // Helper function to capture pod data for dismissal
    function capturePodDataForDismissal(downloadKey) {
      const cardData = activeDownloadCards.get(downloadKey);
      if (!cardData || !cardData.download) {
        debugLog(`[Dismiss] No card data found for capturing: ${downloadKey}`);
        return null;
      }
      
      const download = cardData.download;
      const podElement = cardData.podElement;
      
      // Capture essential data for pile reconstruction
      const dismissedData = {
        key: downloadKey,
        filename: download.aiName || cardData.originalFilename || getSafeFilename(download),
        originalFilename: cardData.originalFilename,
        fileSize: download.currentBytes || download.totalBytes || 0,
        contentType: download.contentType,
        targetPath: download.target?.path,
        sourceUrl: download.source?.url,
        startTime: download.startTime,
        endTime: download.endTime,
        dismissTime: Date.now(),
        wasRenamed: !!download.aiName,
        // Capture preview data
        previewData: null,
        dominantColor: podElement?.dataset?.dominantColor || null
      };
      
      // Try to capture preview image data
      if (podElement) {
        const previewContainer = podElement.querySelector('.card-preview-container');
        if (previewContainer) {
          const img = previewContainer.querySelector('img');
          if (img && img.src) {
            dismissedData.previewData = {
              type: 'image',
              src: img.src
            };
          } else {
            // Capture icon/text preview
            dismissedData.previewData = {
              type: 'icon',
              html: previewContainer.innerHTML
            };
          }
        }
      }
      
      debugLog(`[Dismiss] Captured pod data for pile:`, dismissedData);
      return dismissedData;
    }

    // Function to check if required CSS styles are loaded
    function checkCSSAvailability() {
      try {
        console.log('[CSS Debug] Starting CSS availability check...');
        
        // First, let's check if any stylesheets are loaded
        const stylesheets = Array.from(document.styleSheets);
        console.log('[CSS Debug] Found stylesheets:', stylesheets.length);
        
        // Try to find our CSS by looking for specific rules
        let foundTidyDownloadsCSS = false;
        let matchedTidyCSSHref = null;
        for (let sheet of stylesheets) {
          try {
            if (sheet.href && sheet.href.includes('zen-tidy-downloads')) {
              console.log('[CSS Debug] Found zen-tidy-downloads stylesheet:', sheet.href);
              foundTidyDownloadsCSS = true;
              matchedTidyCSSHref = sheet.href;
              break;
            }
            // Check rules if accessible
            if (sheet.cssRules) {
              for (let rule of sheet.cssRules) {
                if (rule.selectorText && 
                    (rule.selectorText.includes('#userchrome-download-cards-container') ||
                     rule.selectorText.includes('.details-tooltip'))) {
                  console.log('[CSS Debug] Found tidy downloads CSS rule:', rule.selectorText);
                  foundTidyDownloadsCSS = true;
                  break;
                }
              }
            }
          } catch (e) {
            // Some stylesheets might not be accessible due to CORS
            console.log('[CSS Debug] Could not access stylesheet rules (normal for external CSS)');
          }
          if (foundTidyDownloadsCSS) break;
        }
        
        // Create test elements for different classes that should be styled by our CSS
        const testTooltip = document.createElement('div');
        testTooltip.className = 'details-tooltip master-tooltip';
        testTooltip.style.position = 'absolute';
        testTooltip.style.left = '-9999px';
        testTooltip.style.top = '-9999px';
        testTooltip.style.visibility = 'hidden';
        document.body.appendChild(testTooltip);
        
        const testContainer = document.createElement('div');
        testContainer.id = 'userchrome-download-cards-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        testContainer.style.top = '-9999px';
        testContainer.style.visibility = 'hidden';
        document.body.appendChild(testContainer);
        
        // Force a reflow to ensure styles are computed
        testTooltip.offsetHeight;
        testContainer.offsetHeight;
        
        // Check if the CSS is applied by testing specific properties
        const tooltipStyle = window.getComputedStyle(testTooltip);
        const containerStyle = window.getComputedStyle(testContainer);
        
        console.log('[CSS Debug] Tooltip computed styles:', {
          position: tooltipStyle.position,
          backgroundColor: tooltipStyle.backgroundColor,
          borderRadius: tooltipStyle.borderRadius,
          zIndex: tooltipStyle.zIndex,
          backdropFilter: tooltipStyle.backdropFilter,
          webkitBackdropFilter: tooltipStyle.webkitBackdropFilter,
          display: tooltipStyle.display
        });
        
        console.log('[CSS Debug] Container computed styles:', {
          position: containerStyle.position,
          zIndex: containerStyle.zIndex,
          pointerEvents: containerStyle.pointerEvents,
          display: containerStyle.display,
          flexDirection: containerStyle.flexDirection
        });
        
        // Test for specific CSS properties that should be set by our stylesheet
        // Updated to match the actual CSS properties in zen-tidy-downloads/chrome.css
        // We need ALL the conditions to be more strict since we were getting false positives
        const tooltipHasStyling = tooltipStyle.position === 'relative' && 
                                 tooltipStyle.backgroundColor.includes('rgba(0, 0, 0, 0.9)') &&
                                 tooltipStyle.borderRadius === '10px' &&
                                 tooltipStyle.zIndex === '51';
        
        const containerHasStyling = containerStyle.position === 'fixed' &&
                                   containerStyle.zIndex === '50' &&
                                   containerStyle.pointerEvents === 'none' &&
                                   containerStyle.display === 'flex' && 
                                   containerStyle.flexDirection === 'column';
        
        // Clean up test elements
        document.body.removeChild(testTooltip);
        document.body.removeChild(testContainer);
        
        const hasExpectedStyling = tooltipHasStyling || containerHasStyling;
        
        console.log('[CSS Debug] Styling detection results:', {
          tooltipHasStyling,
          containerHasStyling,
          hasExpectedStyling,
          foundTidyDownloadsCSS
        });
        
        // If we found the CSS file but styling isn't detected, it might be a timing issue
        // Let's be more lenient if we found the CSS file
        if (foundTidyDownloadsCSS || hasExpectedStyling) {
          console.log('[CSS Check] ✅ CSS detected successfully!');
          debugLog('[CSS Check] Required CSS styles detected and loaded successfully', {
            foundCSSFile: foundTidyDownloadsCSS,
            tooltipStyling: tooltipHasStyling,
            containerStyling: containerHasStyling,
            tooltipPosition: tooltipStyle.position,
            tooltipBgColor: tooltipStyle.backgroundColor,
            containerPosition: containerStyle.position
          });
          return true;
        } else {
          console.warn('Download Preview Script: Required CSS file not found or not loaded properly.');
          console.warn('Expected styling properties were not detected on test elements.');
          console.warn('The script will be disabled to prevent unstyled UI elements.');
          console.warn('Please ensure the CSS file is in the correct location and properly linked.');
          try {
            const dirSvc = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
            const profD = dirSvc.get("ProfD", Ci.nsIFile);

            const candidates = [];
            const zenThemes = profD.clone();
            zenThemes.append("chrome");
            zenThemes.append("zen-themes");
            zenThemes.append("zen-tidy-downloads");
            zenThemes.append("chrome.css");
            candidates.push(zenThemes);

            const sineMods = profD.clone();
            sineMods.append("chrome");
            sineMods.append("sine-mods");
            sineMods.append("zen-tidy-downloads");
            sineMods.append("chrome.css");
            candidates.push(sineMods);

            // Log actual matched stylesheet href if any
            if (matchedTidyCSSHref) {
              console.warn(`Detected stylesheet href containing 'zen-tidy-downloads': ${matchedTidyCSSHref}`);
            } else {
              console.warn('No loaded stylesheet href containing "zen-tidy-downloads" was detected.');
            }

            // Report candidate locations and whether files exist
            for (const file of candidates) {
              let exists = false;
              try { exists = file.exists(); } catch (_) { exists = false; }
              console.warn(`Candidate CSS path: ${file.path}  (exists: ${exists})`);
            }
          } catch (e) {
            console.warn('CSS file should be at one of:');
            console.warn(' - <profile>/chrome/zen-themes/zen-tidy-downloads/chrome.css');
            console.warn(' - <profile>/chrome/sine-mods/zen-tidy-downloads/chrome.css');
          }
          debugLog('[CSS Check] CSS detection failed', {
            foundCSSFile: foundTidyDownloadsCSS,
            tooltipPosition: tooltipStyle.position,
            tooltipBgColor: tooltipStyle.backgroundColor,
            tooltipBorderRadius: tooltipStyle.borderRadius,
            tooltipZIndex: tooltipStyle.zIndex,
            containerPosition: containerStyle.position,
            containerZIndex: containerStyle.zIndex,
            containerPointerEvents: containerStyle.pointerEvents,
            containerDisplay: containerStyle.display
          });
          return false;
        }
      } catch (error) {
        console.error('Download Preview Script: Error checking CSS availability:', error);
        console.warn('The script will be disabled as a safety measure.');
        return false;
      }
    }

    // Add debug logging function with Firefox preferences support
    function debugLog(message, data = null, category = 'general') {
      try {
        const debugEnabled = getPref("extensions.downloads.enable_debug", false);
        const debugAiOnly = getPref("extensions.downloads.debug_ai_only", true);
        
        if (!debugEnabled) return;
        if (debugAiOnly && category !== 'aiRename' && category !== 'general') return;
        
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] Download Preview [${category.toUpperCase()}]:`;
        
        if (data) {
          console.log(`${prefix} ${message}`, data);
        } else {
          console.log(`${prefix} ${message}`);
        }
      } catch (e) {
        // Fallback if preferences fail
        console.log(`[Download Preview] ${message}`, data || '');
      }
    }

    // Read preferences safely with defaults
    function getPref(prefName, defaultValue) {
      try {
        const prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
        const t = typeof defaultValue;
        if (t === 'boolean') return prefs.getBoolPref(prefName, defaultValue);
        if (t === 'number') return prefs.getIntPref(prefName, defaultValue);
        return prefs.getStringPref(prefName, defaultValue ?? "");
      } catch (_) {
        return defaultValue;
      }
    }

    // Decide active AI provider based on toggles and available credentials
    function getActiveAIProvider() {
      try {
        if (!getPref('extensions.downloads.enable_ai_renaming', true)) return null;
        // Priority: mistral, openai, openrouter, anthropic, gemini, deepseek, ollama
        if (getPref('extensions.downloads.mistral_enabled', false)) {
          if (getPref('extensions.downloads.mistral_api_key', '')) return 'mistral';
        }
        if (getPref('extensions.downloads.openai_enabled', false)) {
          if (getPref('extensions.downloads.openai_api_key', '')) return 'openai';
        }
        if (getPref('extensions.downloads.openrouter_enabled', false)) {
          if (getPref('extensions.downloads.openrouter_api_key', '')) return 'openrouter';
        }
        if (getPref('extensions.downloads.anthropic_enabled', false)) {
          if (getPref('extensions.downloads.anthropic_api_key', '')) return 'anthropic';
        }
        if (getPref('extensions.downloads.gemini_enabled', false)) {
          if (getPref('extensions.downloads.gemini_api_key', '')) return 'gemini';
        }
        if (getPref('extensions.downloads.deepseek_enabled', false)) {
          if (getPref('extensions.downloads.deepseek_api_key', '')) return 'deepseek';
        }
        if (getPref('extensions.downloads.ollama_enabled', false)) {
          // Ollama is local; no key required
          return 'ollama';
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    // Improved key generation for downloads
    function getDownloadKey(download) {
      // Use target path as primary key since id is often undefined
      if (download?.target?.path) {
        return download.target.path;
      }
      if (download?.id) {
        return download.id;
      }
      // For failed downloads, generate a more stable key based on URL and start time
      const url = download?.source?.url || download?.url || "unknown";
      const startTime = download?.startTime || Date.now();
      const key = `temp_${url}_${startTime}`;
      
      debugLog(`[KeyGen] Generated temporary key for download without path/id`, { 
        key, 
        hasPath: !!download?.target?.path, 
        hasId: !!download?.id, 
        url, 
        error: !!download?.error,
        startTime 
      });
      
      return key;
    }

    // Get safe filename from download object
    function getSafeFilename(download) {
      // Try multiple sources for filename
      if (download.filename) return download.filename;
      if (download.target?.path) {
        return download.target.path.split(/[\\/]/).pop();
      }
      if (download.source?.url) {
        const url = download.source.url;
        const match = url.match(/\/([^\/\?]+)$/);
        if (match) return match[1];
      }
      return "Untitled";
    }

    // --- Helpers for AI Rename Pipeline ---
    function getDirectoryPath(fullPath) {
      try {
        const idx = fullPath.lastIndexOf(PATH_SEPARATOR);
        return idx === -1 ? '' : fullPath.substring(0, idx);
      } catch { return ''; }
    }
    
    function getFileExtension(fullPathOrName) {
      try {
        const base = fullPathOrName.split(/[\\\/]/).pop();
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.substring(dot) : '';
      } catch { return ''; }
    }
    
    function sanitizeFilename(name) {
      // Remove illegal characters and normalize spacing
      let out = String(name || '').trim();
      out = out.replace(/[<>:"\/\\|?*\x00-\x1F]/g, ' ');
      out = out.replace(/\s+/g, ' ').trim();
      // Avoid reserved Windows names
      const reserved = new Set(['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9']);
      if (reserved.has(out.toUpperCase())) out = out + ' file';
      // No trailing dots/spaces on Windows
      out = out.replace(/[ .]+$/g, '');
      if (!out) out = 'file';
      return out;
    }
    
    function truncateFilename(baseNoExt, ext) {
      const maxLen = Math.max(10, Number(getPref('extensions.downloads.max_filename_length', 70)) || 70);
      const room = Math.max(1, maxLen - (ext ? ext.length : 0));
      if (baseNoExt.length <= room) return baseNoExt;
      return baseNoExt.slice(0, Math.max(1, room - 1)) + '…';
    }
    
    function ensureUniqueFilename(dirPath, desiredName) {
      try {
        // desiredName includes extension
        const dot = desiredName.lastIndexOf('.');
        const base = dot > 0 ? desiredName.substring(0, dot) : desiredName;
        const ext = dot > 0 ? desiredName.substring(dot) : '';
        let attempt = 0;
        while (true) {
          const candidate = attempt === 0 ? desiredName : `${base} (${attempt})${ext}`;
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(dirPath + PATH_SEPARATOR + candidate);
          if (!f.exists()) return candidate;
          attempt++;
          if (attempt > 9999) return desiredName; // Safety
        }
      } catch (e) {
        debugLog('[AI] ensureUniqueFilename error', e, 'aiRename');
        return desiredName;
      }
    }
    
    function shouldAttemptAIRename(download, cardData) {
      try {
        if (!getPref('extensions.downloads.enable_ai_renaming', true)) return false;
        if (!aiRenamingPossible) return false;
        if (!download || !download.target || !download.target.path) return false;
        if (download.canceled || download.error) return false;
        if (!download.succeeded) return false;
        if (download.aiName) return false; // Already renamed
        if (renamedFiles.has(download.target.path)) return false; // Prevent loops
    
        const ext = getFileExtension(download.target.path).toLowerCase();
        const blocked = new Set(['.exe','.msi','.bat','.cmd','.sh','.dmg','.appimage']);
        if (blocked.has(ext)) return false;
    
        const sizeLimit = Math.max(0, Number(getPref('extensions.downloads.max_file_size_for_ai', 52428800)) || 52428800);
        const size = Number(download.totalBytes || download.currentBytes || 0);
        if (sizeLimit > 0 && size > sizeLimit) return false;
        return true;
      } catch { return false; }
    }
    
    function buildAIRenamePrompt(download, ext) {
      const origName = getSafeFilename(download);
      const baseName = origName && origName.includes('.') ? origName.substring(0, origName.lastIndexOf('.')) : origName;
      const ct = download.contentType || '';
      return (
        `You are a filename generator. Based on the original name "${baseName}" and file type "${ct}" ` +
        `produce a short, descriptive filename for saving the file. Do NOT include the extension. ` +
        `Constraints: 1) 4-70 characters, 2) readable words, 3) avoid dates/hashes unless meaningful, ` +
        `4) no quotes or punctuation at ends, 5) use spaces or hyphens, 6) no slurs or unsafe content. ` +
        `Return ONLY the filename text (no extension, no quotes).`
      );
    }
    
    async function attemptAIRename(downloadKey) {
      try {
        const cardData = activeDownloadCards.get(downloadKey);
        if (!cardData) return;
        const download = cardData.download;
        if (!shouldAttemptAIRename(download, cardData)) return;
    
        const oldFullPath = download.target.path;
        const dirPath = getDirectoryPath(oldFullPath);
        const origName = getSafeFilename(download);
        const ext = getFileExtension(origName);
    
        // Track process for potential cancellation
        const abortController = new AbortController();
        activeAIProcesses.set(downloadKey, {
          abortController,
          startTime: Date.now(),
          processState: { phase: 'prompting' }
        });
        
        // Unified cleanup to prevent stuck states
        let cleanupDone = false;
        function cleanupAI() {
          if (cleanupDone) return;
          cleanupDone = true;
          try {
            const proc = activeAIProcesses.get(downloadKey);
            if (proc) activeAIProcesses.delete(downloadKey);
            if (cardData?.podElement) {
              cardData.podElement.classList.remove('renaming-active');
              cardData.podElement.classList.remove('renaming-initiated');
            }
          } catch (_) {}
        }
        
        // Safety timeout to prevent hanging AI calls
        const timeoutMs = Math.max(3000, Number(getPref('extensions.downloads.ai_call_timeout_ms', 20000)) || 20000);
        const aiTimeoutId = setTimeout(() => {
          debugLog('[AI] Aborting AI call due to timeout', { timeoutMs }, 'aiRename');
          try { abortController.abort(); } catch (_) {}
        }, timeoutMs);
    
        // UI state
        try {
          if (cardData.podElement) {
            cardData.podElement.classList.add('renaming-initiated');
            cardData.podElement.classList.add('renaming-active');
          }
          if (focusedDownloadKey === downloadKey && masterTooltipDOMElement) {
            const statusEl = masterTooltipDOMElement.querySelector('.card-status');
            if (statusEl) {
              statusEl.textContent = 'Renaming with AI…';
              statusEl.style.color = '';
            }
          }
        } catch (_) {}
    
        // Build prompt and optionally include image context
        const prompt = buildAIRenamePrompt(download, ext);
        const isImage = ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.tiff','.heic','.heif'].includes(ext.toLowerCase());
    
        debugLog('[AI] Calling provider for rename', { downloadKey, ext, isImage }, 'aiRename');
        let aiResult;
        try {
          aiResult = await callAI({
            prompt,
            localPath: isImage ? oldFullPath : undefined,
            fileExtension: isImage ? ext : undefined,
            abortSignal: abortController.signal
          });
        } finally {
          clearTimeout(aiTimeoutId);
        }
    
        if (aiResult === 'rate-limited') {
          debugLog('[AI] Provider rate-limited; skipping rename', null, 'aiRename');
          cleanupAI();
          return;
        }
        if (!aiResult || typeof aiResult !== 'string') {
          debugLog('[AI] Empty AI result; skipping rename', null, 'aiRename');
          cleanupAI();
          return;
        }
    
        // Sanitize and build final name
        let candidateBase = sanitizeFilename(aiResult);
        candidateBase = truncateFilename(candidateBase, ext);
        if (!candidateBase) { cleanupAI(); return; }
        let finalName = candidateBase + ext;
        if (finalName.toLowerCase() === origName.toLowerCase()) {
          debugLog('[AI] Proposed name equals original; skipping move', { finalName }, 'aiRename');
          cleanupAI();
          return;
        }
        finalName = ensureUniqueFilename(dirPath, finalName);
    
        // Perform move on disk
        try {
          const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          file.initWithPath(oldFullPath);
          if (!file.exists()) {
            debugLog('[AI] File no longer exists; aborting rename', { oldFullPath }, 'aiRename');
            return;
          }
    
          // Save originals for undo
          cardData.trueOriginalSimpleNameBeforeAIRename = origName;
          cardData.trueOriginalPathBeforeAIRename = oldFullPath;
    
          file.moveTo(null, finalName);
          const newFullPath = dirPath + PATH_SEPARATOR + finalName;
          debugLog('[AI] File renamed', { from: oldFullPath, to: newFullPath }, 'aiRename');
    
          // Update download object and internal keys
          download.target.path = newFullPath;
          download.aiName = finalName;
    
          // Update activeDownloadCards key and ordering
          if (activeDownloadCards.has(downloadKey)) {
            activeDownloadCards.delete(downloadKey);
            activeDownloadCards.set(newFullPath, cardData);
            cardData.key = newFullPath;
            if (cardData.podElement) cardData.podElement.dataset.downloadKey = newFullPath;
            const idx = orderedPodKeys.indexOf(downloadKey);
            if (idx > -1) orderedPodKeys.splice(idx, 1, newFullPath);
            if (focusedDownloadKey === downloadKey) focusedDownloadKey = newFullPath;
          }

          // Migrate any pending image preview retries to the new key and refresh the card
          try {
            if (imagePreviewRetryState.has(downloadKey)) {
              const prevAttempts = imagePreviewRetryState.get(downloadKey);
              imagePreviewRetryState.delete(downloadKey);
              imagePreviewRetryState.set(newFullPath, prevAttempts);
            }
            // Force an immediate update to set preview src with the new path
            createOrUpdateCard(download, false);
          } catch (_) {}
    
          // Mark renamed to avoid loops
          renamedFiles.add(oldFullPath);
          renamedFiles.add(newFullPath);
    
          // Update UI
          try {
            if (focusedDownloadKey === newFullPath && masterTooltipDOMElement) {
              const titleEl = masterTooltipDOMElement.querySelector('.card-title');
              const statusEl = masterTooltipDOMElement.querySelector('.card-status');
              const originalEl = masterTooltipDOMElement.querySelector('.card-original-filename');
              if (titleEl) titleEl.textContent = finalName;
              if (statusEl) { statusEl.textContent = 'Renamed by AI'; statusEl.style.color = '#2ecc71'; }
              if (originalEl) { originalEl.style.display = 'block'; originalEl.textContent = cardData.originalFilename || ''; }
            }
            // Ensure undo visibility is recalculated immediately
            try { updateUIForFocusedDownload(focusedDownloadKey || newFullPath, true); } catch (_) {}
          } catch (_) {}
    
        } finally {
          // Clear UI state and process tracking
          cleanupAI();
        }
      } catch (err) {
        debugLog('[AI] attemptAIRename failed', err, 'aiRename');
        // Best-effort cleanup
        cleanupAI();
      }
    }

    // --- Late CSS Activation + Post-CSS Initialization ---
    let cssRetryTimer = null;
    function scheduleLateCSSActivation(maxTries = 30, intervalMs = 1000) {
      let tries = 0;
      if (cssRetryTimer) {
        clearInterval(cssRetryTimer);
        cssRetryTimer = null;
      }
      cssRetryTimer = setInterval(async () => {
        tries++;
        const ok = checkCSSAvailability();
        if (ok) {
          clearInterval(cssRetryTimer);
          cssRetryTimer = null;
          console.log('[CSS Check] ✅ CSS detected later. Resuming initialization.');
          await continueInitializationAfterCSS();
        } else if (tries >= maxTries) {
          clearInterval(cssRetryTimer);
          cssRetryTimer = null;
          console.log('[CSS Check] Gave up waiting for late CSS. You can set extensions.downloads.skip_css_check = true to debug.');
        }
      }, intervalMs);
      console.log(`[CSS Check] Waiting for late CSS (up to ${maxTries} tries, ${intervalMs}ms interval)...`);
    }

    async function continueInitializationAfterCSS() {
      try {
        cssStylesAvailable = true;
        debugLog('Continuing initialization after CSS is ready');
        // Verify AI provider connectivity (sets aiRenamingPossible)
        await verifyMistralConnection();
        debugLog('[AI] Verification complete (post-CSS)', { provider: getActiveAIProvider(), aiRenamingPossible }, 'aiRename');
        // Build UI and wire events
        ensureUIContainers();
        await setupDownloadListeners();
        // Optional UI sync helpers if present later in file
        try { initSidebarWidthSync && initSidebarWidthSync(); } catch (_) {}
        console.log('=== Zen Tidy Downloads READY (late CSS) ===');
      } catch (e) {
        console.error('Error during post-CSS initialization:', e);
      }
    }

    // --- Minimal UI + Downloads wiring ---
    function ensureUIContainers() {
      if (downloadCardsContainer && masterTooltipDOMElement && podsRowContainerElement) return;
      // Root container
      let container = document.getElementById('userchrome-download-cards-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'userchrome-download-cards-container';
        document.documentElement.appendChild(container);
      }
      downloadCardsContainer = container;

      // Master tooltip
      let tooltip = container.querySelector('.details-tooltip.master-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'details-tooltip master-tooltip';
        // Build structure with createElement to avoid sanitizers removing <button>
        const statusEl = document.createElement('div');
        statusEl.className = 'card-status';
        const titleEl = document.createElement('div');
        titleEl.className = 'card-title';
        const origEl = document.createElement('div');
        origEl.className = 'card-original-filename';
        const progressEl = document.createElement('div');
        progressEl.className = 'card-progress';
        const sizeEl = document.createElement('div');
        sizeEl.className = 'card-filesize';

        const btns = document.createElement('div');
        btns.className = 'tooltip-buttons-container';
        const undoBtn = document.createElement('button');
        undoBtn.className = 'card-undo-button';
        undoBtn.title = 'Undo rename';
        undoBtn.textContent = '↩';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'card-close-button';
        closeBtn.title = 'Dismiss';
        closeBtn.textContent = '×';
        btns.appendChild(undoBtn);
        btns.appendChild(closeBtn);

        const tail = document.createElement('div');
        tail.className = 'tooltip-tail';

        tooltip.appendChild(statusEl);
        tooltip.appendChild(titleEl);
        tooltip.appendChild(origEl);
        tooltip.appendChild(progressEl);
        tooltip.appendChild(sizeEl);
        tooltip.appendChild(btns);
        tooltip.appendChild(tail);

        container.appendChild(tooltip);
      }
      masterTooltipDOMElement = tooltip;
      
      // Wire tooltip buttons once
      if (masterTooltipDOMElement && !masterTooltipDOMElement.dataset.wired) {
        const undoBtn = masterTooltipDOMElement.querySelector('.card-undo-button');
        const closeBtn = masterTooltipDOMElement.querySelector('.card-close-button');
        if (undoBtn) {
          undoBtn.addEventListener('click', (e) => {
            try {
              e.stopPropagation();
              if (focusedDownloadKey) {
                undoRename(focusedDownloadKey);
              }
            } catch (_) {}
          });
        }
        if (closeBtn) {
          closeBtn.addEventListener('click', (e) => {
            try {
              e.stopPropagation();
              // Dismiss the currently focused download (same behavior as context menu)
              const key = focusedDownloadKey;
              if (!key) {
                masterTooltipDOMElement.setAttribute('data-visible', 'false');
                return;
              }
              dismissedDownloads.add(key);
              const cd = activeDownloadCards.get(key);
              if (cd?.podElement) cd.podElement.remove();
              activeDownloadCards.delete(key);
              const idx = orderedPodKeys.indexOf(key);
              if (idx !== -1) orderedPodKeys.splice(idx, 1);
              if (focusedDownloadKey === key) {
                focusedDownloadKey = null;
              }
              masterTooltipDOMElement.setAttribute('data-visible', 'false');
            } catch (_) {}
          });
        }
        masterTooltipDOMElement.dataset.wired = 'true';
      }

      // Pods row
      let podsRow = document.getElementById('userchrome-pods-row-container');
      if (!podsRow) {
        podsRow = document.createElement('div');
        podsRow.id = 'userchrome-pods-row-container';
        container.appendChild(podsRow);
      }
      podsRowContainerElement = podsRow;
    }

    async function setupDownloadListeners() {
      try {
        const list = await window.Downloads.getList(window.Downloads.ALL);
        const view = {
          onDownloadAdded: (download) => {
            debugLog('[Downloads] Added', { id: download.id, path: download.target?.path });
            throttledCreateOrUpdateCard(download, true);
          },
          onDownloadChanged: (download) => {
            throttledCreateOrUpdateCard(download, false);
          },
          onDownloadRemoved: (download) => {
            const key = getDownloadKey(download);
            debugLog('[Downloads] Removed', { key });
            // Notify external listeners
            try {
              actualDownloadRemovedEventListeners.forEach(cb => {
                try { cb(key, download); } catch (_) {}
              });
            } catch (_) {}
            // Hide/remove UI for this key
            const cardData = activeDownloadCards.get(key);
            if (cardData?.podElement) {
              cardData.podElement.remove();
            }
            activeDownloadCards.delete(key);
            const idx = orderedPodKeys.indexOf(key);
            if (idx !== -1) orderedPodKeys.splice(idx, 1);
            if (focusedDownloadKey === key) {
              focusedDownloadKey = orderedPodKeys[orderedPodKeys.length - 1] || null;
              if (focusedDownloadKey) updateUIForFocusedDownload(focusedDownloadKey, false);
            }
          }
        };
        await list.addView(view);

        // Populate existing recent downloads
        const hours = Math.max(0, Number(getPref('extensions.downloads.show_old_downloads_hours', 2)) || 0);
        const cutoff = Date.now() - hours * 3600 * 1000;
        const all = await list.getAll();
        for (const dl of all) {
          // Skip very old ones
          const st = dl.startTime ? new Date(dl.startTime).getTime() : Date.now();
          if (st >= cutoff) throttledCreateOrUpdateCard(dl, false);
        }
        debugLog('[Downloads] Listeners registered and initial population complete');
      } catch (e) {
        console.error('Failed to set up Downloads listeners:', e);
      }
    }

    function throttledCreateOrUpdateCard(download, bringToFront) {
      try {
        const key = getDownloadKey(download);
        const last = cardUpdateThrottle.get(key) || 0;
        const throttleMs = Math.max(0, Number(getPref('extensions.downloads.progress_update_throttle_ms', 500)) || 0);
        const now = Date.now();
        // Always process completion events immediately so AI rename can trigger,
        // even if they occur within the throttle window
        const isCompletion = !!(download && download.succeeded);
        if ((now - last < throttleMs) && !bringToFront && !isCompletion) return;
        cardUpdateThrottle.set(key, now);
        createOrUpdateCard(download, bringToFront);
      } catch (e) {
        console.error('throttledCreateOrUpdateCard error:', e);
      }
    }

    function createOrUpdateCard(download, bringToFront) {
      ensureUIContainers();
      const key = getDownloadKey(download);
      if (dismissedDownloads.has(key)) return; // Respect dismissed state

      let cardData = activeDownloadCards.get(key);
      if (!cardData) {
        // New card
        const pod = document.createElement('div');
        pod.className = 'download-pod';
        pod.dataset.downloadKey = key;
        // Preview container (image or icon)
        const preview = document.createElement('div');
        preview.className = 'card-preview-container';
        const img = document.createElement('img');
        try {
          img.alt = '';
          img.decoding = 'async';
          img.loading = 'lazy';
          // If the image fails to load (e.g., renamed between set and fetch), clear flag and retry
          img.addEventListener('error', () => {
            try {
              img.style.opacity = '';
              img.removeAttribute('src');
              delete img.dataset.srcSet;
              const k = pod.dataset.downloadKey;
              if (k) scheduleImagePreviewRetry(k);
            } catch (_) {}
          }, { once: false });
          img.addEventListener('load', () => {
            try {
              img.style.opacity = '1';
              img.dataset.srcSet = '1';
              const k = pod.dataset.downloadKey;
              if (k) imagePreviewRetryState.delete(k);
            } catch (_) {}
          }, { once: false });
        } catch (_) {}
        preview.appendChild(img);
        pod.appendChild(preview);
        // Left-click toggles the tooltip for this item
        pod.addEventListener('click', (e) => {
          try {
            e.stopPropagation();
            const currentKey = e.currentTarget?.dataset?.downloadKey || key;
            const visible = masterTooltipDOMElement?.getAttribute('data-visible') === 'true';
            if (focusedDownloadKey === currentKey && visible) {
              masterTooltipDOMElement.setAttribute('data-visible', 'false');
            } else {
              focusedDownloadKey = currentKey;
              updateUIForFocusedDownload(currentKey, true);
            }
          } catch (_) {}
        });
        // Right-click opens context menu
        pod.addEventListener('contextmenu', (e) => {
          try {
            e.preventDefault();
            e.stopPropagation();
            const currentKey = e.currentTarget?.dataset?.downloadKey || key;
            focusedDownloadKey = currentKey;
            showContextMenuForPod(currentKey, e.clientX, e.clientY);
          } catch (_) {}
        });
        podsRowContainerElement.appendChild(pod);
        cardData = {
          key,
          download,
          podElement: pod,
          originalFilename: getSafeFilename(download),
          aiRenameTriggered: false,
          isWaitingForZenAnimation: false,
          domAppended: true
        };
        activeDownloadCards.set(key, cardData);
        orderedPodKeys.push(key);
      } else {
        // Update existing
        cardData.download = download;
      }

      // Lightweight visual state updates
      const pod = cardData.podElement;
      if (download.succeeded) {
        pod.classList.add('completed');
      } else {
        pod.classList.remove('completed');
      }
      if (download.canceled) pod.classList.add('canceled'); else pod.classList.remove('canceled');
      if (download.error) pod.classList.add('error'); else pod.classList.remove('error');
      pod.setAttribute('data-visible', 'true');

      // Try to set preview image for image downloads; fallback to system icon for non-images
      try {
        const path = download?.target?.path || '';
        const isImage = /\.(png|jpe?g|webp|gif|bmp|ico|tif?f|avif|svg)$/i.test(path);
        const imgEl = pod.querySelector('.card-preview-container img');
        if (imgEl && !imgEl.dataset.srcSet) {
          const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          const ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
          try { file.initWithPath(path); } catch (_) {}
          if (isImage && path) {
            // Only set the actual image once the file exists and is readable,
            // otherwise wait for a later update to retry (avoid locking in a broken img)
            try {
              if (file && file.exists() && file.isReadable()) {
                const fileSpec = ios.newFileURI(file).spec; // file:///...
                imgEl.src = fileSpec;
                imgEl.style.opacity = '1';
                imgEl.dataset.srcSet = '1';
              } else {
                // Schedule a retry to load the image soon
                scheduleImagePreviewRetry(key);
              }
            } catch (_) {}
          } else if (path) {
            // Non-image: show system icon immediately
            try {
              try {
                const fileSpec = ios.newFileURI(file).spec; // may throw if invalid
                imgEl.src = `moz-icon://${fileSpec}?size=64`;
              } catch (e1) {
                // Extension-based fallback: moz-icon://.ext
                const match = path.match(/\.([a-z0-9]+)$/i);
                const ext = match ? match[1].toLowerCase() : '';
                imgEl.src = ext ? `moz-icon://.${ext}?size=64` : `moz-icon://.bin?size=64`;
              }
              imgEl.style.opacity = '1';
              imgEl.dataset.srcSet = '1';
            } catch (_) {}
          }
        }
      } catch (_) {}

      // Trigger AI renaming once on completion
      try {
        if (download.succeeded && !cardData.aiRenameTriggered) {
          cardData.aiRenameTriggered = true;
          // Fire and forget; internal guards handle eligibility
          attemptAIRename(key);
        }
      } catch (e) {
        debugLog('[AI] attemptAIRename error', e, 'aiRename');
      }

      // Update tooltip for focused item
      if (bringToFront || !focusedDownloadKey) focusedDownloadKey = key;
      updateUIForFocusedDownload(focusedDownloadKey, false);
    }

    function updateUIForFocusedDownload(key, animate) {
      if (!key) return;
      ensureUIContainers();
      const cardData = activeDownloadCards.get(key);
      if (!cardData) return;

      // Focus styling
      for (const [k, v] of activeDownloadCards.entries()) {
        if (v.podElement) v.podElement.classList.toggle('focused-pod', k === key);
      }

      // Tooltip content
      const dl = cardData.download;
      const titleEl = masterTooltipDOMElement.querySelector('.card-title');
      const statusEl = masterTooltipDOMElement.querySelector('.card-status');
      const originalEl = masterTooltipDOMElement.querySelector('.card-original-filename');
      const progressEl = masterTooltipDOMElement.querySelector('.card-progress');
      const sizeEl = masterTooltipDOMElement.querySelector('.card-filesize');
      const undoEl = masterTooltipDOMElement.querySelector('.card-undo-button');
      if (titleEl) titleEl.textContent = dl.aiName || cardData.originalFilename || getSafeFilename(dl);
      if (originalEl) {
        const hasAI = !!dl.aiName && dl.aiName !== cardData.originalFilename;
        originalEl.style.display = hasAI ? 'block' : 'none';
        if (hasAI) originalEl.textContent = cardData.originalFilename || '';
      }
      if (statusEl) {
        let status = 'Downloading';
        if (dl.succeeded) status = 'Download completed';
        else if (dl.error) status = `Error: ${dl.error?.message || 'Download failed'}`;
        else if (dl.canceled) status = 'Download canceled';
        statusEl.textContent = status;
      }
      if (progressEl) progressEl.textContent = formatProgress(dl);
      const bytes = dl.totalBytes || dl.currentBytes || 0;
      if (sizeEl) {
        sizeEl.textContent = formatFileSize(bytes);
        sizeEl.style.display = bytes > 0 ? 'block' : 'none';
      }
      if (undoEl) {
        const haveStoredSimple = !!cardData.trueOriginalSimpleNameBeforeAIRename;
        const haveStoredPath = !!cardData.trueOriginalPathBeforeAIRename;
        const haveFallbackSimple = !!cardData.originalFilename;
        const showUndo = !!dl.aiName && (haveStoredSimple || haveFallbackSimple);
        undoEl.style.display = showUndo ? 'inline-block' : 'none';
      }

      masterTooltipDOMElement.setAttribute('data-visible', 'true');
    }

    function scheduleImagePreviewRetry(key) {
      try {
        const attempts = imagePreviewRetryState.get(key) || 0;
        if (attempts >= 15) return;
        imagePreviewRetryState.set(key, attempts + 1);
        setTimeout(() => {
          try {
            // Handle case where key changed due to AI rename: try fallback lookup
            let cd = activeDownloadCards.get(key);
            if (!cd) {
              try {
                for (const v of activeDownloadCards.values()) {
                  if (v && (v.trueOriginalPathBeforeAIRename === key)) { cd = v; break; }
                }
              } catch (_) {}
            }
            if (!cd) return;
            // Re-run update for this card only; bypass throttle for quick retry
            createOrUpdateCard(cd.download, false);
          } catch (_) {}
        }, 300);
      } catch (_) {}
    }

    // Simple context menu for preview pods
    let contextMenuEl = null;
    function ensureContextMenu() {
      if (contextMenuEl) return contextMenuEl;
      contextMenuEl = document.createElement('div');
      contextMenuEl.id = 'ztd-context-menu';
      contextMenuEl.style.cssText = [
        'position: fixed',
        'z-index: 100000000',
        'min-width: 180px',
        'background: rgba(20,20,20,0.98)',
        'backdrop-filter: blur(20px)',
        'border: 1px solid rgba(255,255,255,0.1)',
        'border-radius: 8px',
        'box-shadow: 0 8px 24px rgba(0,0,0,0.35)',
        'padding: 6px 0',
        'display: none',
        'pointer-events: auto',
        'color: #fff',
        'font-size: 12px'
      ].join(';');
      document.documentElement.appendChild(contextMenuEl);
      document.addEventListener('click', () => hideContextMenu(), true);
      document.addEventListener('contextmenu', () => hideContextMenu(), true);
      return contextMenuEl;
    }
    function hideContextMenu() {
      if (contextMenuEl) contextMenuEl.style.display = 'none';
    }
    function menuItem(label, onClick) {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText = [
        'padding: 8px 12px',
        'cursor: pointer'
      ].join(';');
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', (e) => { e.stopPropagation(); hideContextMenu(); try { onClick(); } catch(_){} });
      return item;
    }
    function showContextMenuForPod(key, x, y) {
      try {
        const menu = ensureContextMenu();
        menu.innerHTML = '';
        const cardData = activeDownloadCards.get(key);
        const dl = cardData?.download;
        menu.appendChild(menuItem('Open file', () => {
          try {
            openDownloadedFile(dl);
          } catch(_) {}
        }));
        menu.appendChild(menuItem('Show All Downloads', () => {
          try {
            // If a Downloads tab already exists, select it
            try {
              if (window.gBrowser && Array.isArray(window.gBrowser.tabs)) {
                const existing = window.gBrowser.tabs.find(t => {
                  try { return t?.linkedBrowser?.currentURI?.spec?.startsWith('about:downloads'); } catch { return false; }
                });
                if (existing) {
                  debugLog('[ContextMenu] Selecting existing about:downloads tab');
                  window.gBrowser.selectedTab = existing;
                  return;
                }
              }
            } catch(_) {}

            // Prefer privileged helpers
            if (typeof window.openTrustedLinkIn === 'function') {
              debugLog('[ContextMenu] Opening about:downloads via openTrustedLinkIn');
              window.openTrustedLinkIn('about:downloads', 'tab');
            } else if (typeof window.openUILinkIn === 'function') {
              debugLog('[ContextMenu] Opening about:downloads via openUILinkIn');
              window.openUILinkIn('about:downloads', 'tab');
            } else if (window.DownloadsPanel && typeof window.DownloadsPanel.showDownloadsHistory === 'function') {
              debugLog('[ContextMenu] Opening downloads history via DownloadsPanel.showDownloadsHistory');
              window.DownloadsPanel.showDownloadsHistory();
            } else if (window.BrowserCommands && typeof window.BrowserCommands.openDownloads === 'function') {
              debugLog('[ContextMenu] Opening downloads via BrowserCommands.openDownloads');
              window.BrowserCommands.openDownloads();
            } else if (window.gBrowser && typeof window.gBrowser.loadOneTab === 'function') {
              debugLog('[ContextMenu] Opening about:downloads via gBrowser.loadOneTab');
              const tab = window.gBrowser.loadOneTab('about:downloads', { inBackground: false });
              window.gBrowser.selectedTab = tab;
            } else if (window.gBrowser) {
              debugLog('[ContextMenu] Opening about:downloads via gBrowser.addTab');
              const tab = window.gBrowser.addTab('about:downloads');
              window.gBrowser.selectedTab = tab;
            } else {
              debugLog('[ContextMenu] Opening about:downloads via window.open (last resort)');
              window.open('about:downloads', '_blank');
            }
          } catch (e) {
            debugLog('[ContextMenu] Failed to open about:downloads, falling back to window.open', e);
            try { window.open('about:downloads', '_blank'); } catch(_) {}
          }
        }));
        menu.appendChild(menuItem('Dismiss this download', () => {
          try {
            dismissedDownloads.add(key);
            const cd = activeDownloadCards.get(key);
            if (cd?.podElement) cd.podElement.remove();
            activeDownloadCards.delete(key);
            const idx = orderedPodKeys.indexOf(key);
            if (idx !== -1) orderedPodKeys.splice(idx, 1);
            if (focusedDownloadKey === key) {
              // On dismiss from context menu, do not auto-focus or reopen tooltip
              focusedDownloadKey = null;
              masterTooltipDOMElement.setAttribute('data-visible', 'false');
            }
          } catch(_) {}
        }));
        // Initial position
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.display = 'block';
        // Clamp within viewport
        try {
          const rect = menu.getBoundingClientRect();
          const margin = 6;
          let left = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
          let top = Math.min(Math.max(margin, y), window.innerHeight - rect.height - margin);
          menu.style.left = `${Math.max(0, left)}px`;
          menu.style.top = `${Math.max(0, top)}px`;
        } catch(_) {}
      } catch (_) {}
    }

    function formatFileSize(bytes) {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let n = Math.max(0, Number(bytes) || 0);
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function formatProgress(dl) {
      try {
        if (dl.succeeded) return '100%';
        const cur = Number(dl.currentBytes || 0);
        const tot = Number(dl.totalBytes || 0);
        if (tot > 0) return `${Math.min(100, Math.round((cur / tot) * 100))}%`;
        if (cur > 0) return `${formatFileSize(cur)} downloaded`;
        return '';
      } catch { return ''; }
    }

    // Robust initialization with CSS timing fix
    async function init() {
      console.log(`=== Zen Tidy Downloads STARTING (version ${ZEN_TIDY_VERSION}) ===`);
      
      // Check if CSS check should be skipped (for debugging)
      const skipCSSCheck = getPref("extensions.downloads.skip_css_check", false);
      
      if (skipCSSCheck) {
        console.log("⚠️ CSS check skipped via preference - script will run without CSS validation");
        cssStylesAvailable = true;
      } else {
        // Wait for CSS to be fully loaded with retries
        cssStylesAvailable = await waitForCSSWithRetries();
        if (!cssStylesAvailable) {
          console.log(`=== Zen Tidy Downloads DISABLED (CSS NOT FOUND) - ${ZEN_TIDY_VERSION} ===`);
          console.log("💡 To bypass this check temporarily, set extensions.downloads.skip_css_check = true in about:config");
          // Do not hard-stop. Keep a light watcher to resume when CSS arrives.
          scheduleLateCSSActivation();
          return; // Exit heavy init for now
        }
      }
      
      debugLog("Starting initialization");
      // Verify AI provider connectivity (sets aiRenamingPossible)
      await verifyMistralConnection();
      debugLog('[AI] Verification complete', { provider: getActiveAIProvider(), aiRenamingPossible }, 'aiRename');
      // Build UI and wire listeners now that CSS is present
      ensureUIContainers();
      await setupDownloadListeners();
      try { initSidebarWidthSync && initSidebarWidthSync(); } catch (_) {}
      console.log('=== Zen Tidy Downloads READY ===');
    }
    init();

async function callAI({ prompt, localPath, fileExtension, abortSignal }) {
  const provider = getActiveAIProvider();
  debugLog('[AI] Selected provider for call', { provider }, 'aiRename');
  if (!provider) return null;
  switch (provider) {
    case 'mistral':
      return await callMistralAPI({ prompt, localPath, fileExtension, abortSignal });
    case 'openai':
      return await callOpenAIAPI({ prompt, abortSignal });
    case 'openrouter':
      return await callOpenRouterAPI({ prompt, localPath, fileExtension, abortSignal });
    case 'anthropic':
      return await callAnthropicAPI({ prompt, abortSignal });
    case 'gemini':
      return await callGeminiAPI({ prompt, abortSignal });
    case 'deepseek':
      return await callDeepSeekAPI({ prompt, abortSignal });
    case 'ollama':
      return await callOllamaAPI({ prompt, localPath, fileExtension, abortSignal });
    default:
      return null;
  }
}

// OpenAI
async function callOpenAIAPI({ prompt, abortSignal }) {
  try {
    const apiKey = getPref('extensions.downloads.openai_api_key', '');
    if (!apiKey) return null;
    const model = getPref('extensions.downloads.openai_model', 'gpt-5-nano');
    const chatUrlPref = getPref('extensions.downloads.openai_api_url', 'https://api.openai.com/v1/chat/completions');

    // Endpoint selection: use Responses API for o3/o4/gpt-4.1/gpt-5 families
    const useResponses = /^(o3|o4|gpt-4\.1|gpt-5)/.test(model);
    let url = chatUrlPref;
    if (useResponses) {
      url = chatUrlPref.includes('/chat/completions')
        ? chatUrlPref.replace('/chat/completions', '/responses')
        : 'https://api.openai.com/v1/responses';
    }

    // Debug which endpoint is being used
    debugLog('OpenAI endpoint selection', {
      model,
      endpoint: useResponses ? 'responses' : 'chat-completions',
      url
    });

    // Build payload per endpoint
    const payload = useResponses
      ? {
          model,
          input: prompt,
          max_output_tokens: 100,
          temperature: 0.2,
        }
      : {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.2,
        };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: abortSignal,
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`OpenAI error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();

    if (!useResponses) {
      const out = data.choices?.[0]?.message?.content?.trim() || null;
      debugLog('OpenAI (chat) response preview', out ? out.slice(0, 120) : out);
      return out;
    }

    // Parse Responses API output robustly
    let text = null;
    if (typeof data.output_text === 'string') {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      try {
        for (const out of data.output) {
          if (Array.isArray(out.content)) {
            for (const part of out.content) {
              if (typeof part.text === 'string') {
                text = (text ? text + ' ' : '') + part.text;
              }
            }
          }
        }
      } catch (e) {
        debugLog('Failed to parse OpenAI Responses output structure', e);
      }
    }
    // Fallback to chat-style choices if present
    if (!text && data.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    }
    debugLog('OpenAI (responses) response preview', text ? text.slice(0, 120) : text);
    return text?.trim() || null;
  } catch (e) {
    console.error('OpenAI API error:', e);
    return null;
  }
}

// OpenRouter
async function callOpenRouterAPI({ prompt, localPath, fileExtension, abortSignal }) {
  try {
    const apiKey = getPref('extensions.downloads.openrouter_api_key', '');
    if (!apiKey) return null;
    const model = getPref('extensions.downloads.openrouter_model', 'openrouter/auto');
    const url = getPref('extensions.downloads.openrouter_api_url', 'https://openrouter.ai/api/v1/chat/completions');

    // Build OpenAI-compatible messages with optional image content
    const content = [{ type: 'text', text: prompt }];
    if (localPath) {
      try {
        const base64 = fileToBase64(localPath);
        if (base64) {
          const mimeType = getMimeTypeFromExtension(fileExtension);
          content.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` }
          });
        }
      } catch (_) {}
    }

    const payload = {
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 100,
      temperature: 0.2,
    };

    if (abortSignal?.aborted) {
      throw new DOMException('API request was aborted', 'AbortError');
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: abortSignal,
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`OpenRouter error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();
    const out = data.choices?.[0]?.message?.content?.trim() || null;
    return out;
  } catch (e) {
    console.error('OpenRouter API error:', e);
    return null;
  }
}

// Anthropic Claude
async function callAnthropicAPI({ prompt, abortSignal }) {
  try {
    const apiKey = getPref('extensions.downloads.anthropic_api_key', '');
    if (!apiKey) return null;
    const model = getPref('extensions.downloads.anthropic_model', 'claude-3-5-haiku-latest');
    const url = getPref('extensions.downloads.anthropic_api_url', 'https://api.anthropic.com/v1/messages');
    const version = getPref('extensions.downloads.anthropic_version', '2023-06-01');
    const payload = {
      model,
      max_tokens: 100,
      messages: [
        { role: 'user', content: [{ type: 'text', text: prompt }] }
      ]
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': version
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`Anthropic error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();
    const text = Array.isArray(data.content) && data.content[0]?.text ? data.content[0].text : null;
    return text ? String(text).trim() : null;
  } catch (e) {
    console.error('Anthropic API error:', e);
    return null;
  }
}

// Google Gemini
async function callGeminiAPI({ prompt, abortSignal }) {
  try {
    const apiKey = getPref('extensions.downloads.gemini_api_key', '');
    if (!apiKey) return null;
    const model = getPref('extensions.downloads.gemini_model', 'gemini-2.5-flash-lite');
    const base = getPref('extensions.downloads.gemini_api_url', 'https://generativelanguage.googleapis.com/v1beta/models/');
    const url = `${base}${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = {
      contents: [
        { role: 'user', parts: [{ text: prompt }] }
      ]
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`Gemini error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? String(text).trim() : null;
  } catch (e) {
    console.error('Gemini API error:', e);
    return null;
  }
}

// DeepSeek
async function callDeepSeekAPI({ prompt, abortSignal }) {
  try {
    const apiKey = getPref('extensions.downloads.deepseek_api_key', '');
    if (!apiKey) return null;
    const model = getPref('extensions.downloads.deepseek_model', 'deepseek-chat');
    const url = getPref('extensions.downloads.deepseek_api_url', 'https://api.deepseek.com/chat/completions');
    const payload = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.2
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`DeepSeek error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('DeepSeek API error:', e);
    return null;
  }
}

// Ollama (local)
async function callOllamaAPI({ prompt, localPath, fileExtension, abortSignal }) {
  try {
    const model = getPref('extensions.downloads.ollama_model', 'llama3.1:latest');
    const url = getPref('extensions.downloads.ollama_endpoint', 'http://localhost:11434/api/generate');

    const payload = { model, prompt, stream: false };

    // If an image is available, attach base64 for vision-capable models
    if (localPath) {
      const base64 = fileToBase64(localPath);
      if (base64) {
        // Ollama expects raw base64 strings in an `images` array on /api/generate
        payload.images = [base64];
        // Optional: light heuristic to warn if model may not be vision-capable
        try {
          const lower = String(model || '').toLowerCase();
          const looksVision = /llava|vision|llama-vision|gpt-4o|vl|clip/.test(lower);
          if (!looksVision) {
            debugLog('[AI] Ollama image attached but model may not be vision-capable', { model }, 'aiRename');
          }
        } catch (_) {}
      } else {
        debugLog('[AI] Ollama image path provided but failed to encode; proceeding without image', { localPath }, 'aiRename');
      }
    }

    // Check for abort before request
    if (abortSignal?.aborted) {
      throw new DOMException('API request was aborted', 'AbortError');
    }

    const tNetStart = Date.now();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal
    });
    if (!resp.ok) {
      if (resp.status === 429) return 'rate-limited';
      debugLog(`Ollama error ${resp.status}: ${resp.statusText}`);
      return null;
    }
    const data = await resp.json();
    debugLog('[AI] Ollama fetch+parse duration (ms)', { ms: Date.now() - tNetStart }, 'aiRename');
    return data?.response ? String(data.response).trim() : null;
  } catch (e) {
    console.error('Ollama API error:', e);
    return null;
  }
}

// Mistral API function - with better error handling
async function callMistralAPI({ prompt, localPath, fileExtension, abortSignal }) {
  try {
    // Get API key
    let apiKey = "";
    try {
      const prefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
      const branch = prefService.getBranch("extensions.downloads.");
      apiKey = branch.getStringPref("mistral_api_key", "");
    } catch (e) {
      debugLog("Failed to get API key from preferences", e);
      return null;
    }

    if (!apiKey) {
      debugLog("No API key found");
      return null;
    }

    // Build message content
    let content = [{ type: "text", text: prompt }];

    // Add image data if provided
    if (localPath) {
      try {
        const imageBase64 = fileToBase64(localPath);
        if (imageBase64) {
          const mimeType = getMimeTypeFromExtension(fileExtension);
          content.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          });
        }
      } catch (e) {
        debugLog("Failed to encode image, proceeding without it", e);
      }
    }

    const payload = {
      model: getPref("extensions.downloads.mistral_model", "mistral-small-latest"),
      messages: [{ role: "user", content: content }],
      max_tokens: 100,
      temperature: 0.2,
    };

    debugLog("Sending API request to Mistral");

    // Check for abort signal before making request
    if (abortSignal?.aborted) {
      throw new DOMException('API request was aborted', 'AbortError');
    }

    const response = await fetch(
      getPref("extensions.downloads.mistral_api_url", "https://api.mistral.ai/v1/chat/completions"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: abortSignal // Pass abort signal to fetch
      }
    );

    if (!response.ok) {
      if (response.status === 429) return "rate-limited";
      debugLog(`API error ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    debugLog("Raw API response:", data);
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("Mistral API error:", error);
    return null;
  }
}

function getMimeTypeFromExtension(ext) {
  switch (ext?.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
    case ".jfif":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "image/jpeg";
  }
}

function fileToBase64(localPath) {
  try {
    if (!localPath) return null;

    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(localPath);

    if (!file.exists() || !file.isReadable()) {
      debugLog("fileToBase64: File does not exist or is not readable", { localPath });
      return null;
    }

    const maxSize = getPref("extensions.downloads.max_file_size_for_ai", 52428800);
    if (file.fileSize > maxSize) {
      debugLog("File too large for base64 conversion");
      return null;
    }

    const tStart = Date.now();
    const fstream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    fstream.init(file, -1, 0, 0);

    const bstream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
    bstream.setInputStream(fstream);

    const bytes = bstream.readBytes(file.fileSize);
    fstream.close();
    bstream.close();

    // Convert to base64 in manageable chunks
    const CHUNK_SIZE = 0x8000;
    const chunks = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      chunks.push(bytes.slice(i, i + CHUNK_SIZE));
    }
    const encoded = btoa(chunks.join(""));
    debugLog('[AI] fileToBase64 duration (ms)', { path: localPath, size: file.fileSize, ms: Date.now() - tStart }, 'aiRename');
    return encoded;
  } catch (e) {
    debugLog("fileToBase64 error:", e);
    return null;
  }
}



  // --- Function to Open Downloaded File ---
  function openDownloadedFile(download) {
    if (!download || !download.target || !download.target.path) {
      debugLog("openDownloadedFile: Invalid download object or path", { download });
      return;
    }

    const filePath = download.target.path;
    debugLog("openDownloadedFile: Attempting to open file", { filePath });

    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(filePath);

      if (file.exists() && file.isReadable()) {
        file.launch(); // Opens with default system application
      } else {
        debugLog("openDownloadedFile: File does not exist or is not readable", { filePath });
        // Optionally, notify the user via the card status or an alert
        // For now, just logging.
      }
    } catch (ex) {
      debugLog("openDownloadedFile: Error launching file", { filePath, error: ex.message, stack: ex.stack });
      // Optionally, notify the user
    }
  }

  // --- Function to Erase Download from Firefox History ---
  async function eraseDownloadFromHistory(download) {
    if (!download) {
      debugLog("eraseDownloadFromHistory: Invalid download object", { download });
      throw new Error("Invalid download object");
    }

    try {
      debugLog("eraseDownloadFromHistory: Attempting to erase download", { 
        id: download.id, 
        path: download.target?.path,
        state: download.state 
      });

      // Get the Downloads list
      const list = await window.Downloads.getList(window.Downloads.ALL);
      
      // Find the download in the list by multiple criteria
      const downloads = await list.getAll();
      const targetDownload = downloads.find(dl => {
        // Try to match by ID first (most reliable)
        if (download.id && dl.id === download.id) return true;
        
        // Fallback to path matching if IDs don't match or are missing
        if (download.target?.path && dl.target?.path && 
            dl.target.path === download.target.path) return true;
            
        // Additional fallback for URL matching (in case path changed)
        if (download.source?.url && dl.source?.url && 
            dl.source.url === download.source.url && 
            download.startTime && dl.startTime &&
            Math.abs(new Date(download.startTime) - new Date(dl.startTime)) < 5000) return true;
            
        return false;
      });
      
      if (targetDownload) {
        // Remove the download from the list (this erases it from history)
        await list.remove(targetDownload);
        debugLog("eraseDownloadFromHistory: Successfully removed download from list", { 
          id: targetDownload.id,
          originalId: download.id,
          path: targetDownload.target?.path 
        });
      } else {
        debugLog("eraseDownloadFromHistory: Download not found in list", { 
          id: download.id,
          path: download.target?.path,
          availableDownloads: downloads.length 
        });
        // It might have already been removed, which is fine for our purposes
      }
      
    } catch (error) {
      debugLog("eraseDownloadFromHistory: Error erasing download", { 
        id: download.id, 
        path: download.target?.path,
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
  }

  // Verify AI provider connection (generic) - kept name for compatibility
  async function verifyMistralConnection() {
    try {
      if (!getPref("extensions.downloads.enable_ai_renaming", true)) {
        debugLog("AI renaming disabled via master toggle. Skipping verification.");
        aiRenamingPossible = false;
        return;
      }

      const provider = getActiveAIProvider();
      if (!provider) {
        debugLog("No AI provider enabled. Skipping verification.");
        aiRenamingPossible = false;
        return;
      }

      // For local Ollama, skip network verification to avoid triggering model pulls
      // and enable AI renaming optimistically. Actual calls are guarded by per-call
      // timeouts and centralized cleanup to prevent hangs.
      if (provider === 'ollama') {
        debugLog("[AI] Skipping verification for local Ollama; enabling AI renaming optimistically.", { provider }, 'aiRename');
        aiRenamingPossible = true;
        return;
      }

      const testPrompt = "Respond with ok";
      let result = null;
      switch (provider) {
        case 'mistral':
          result = await callMistralAPI({ prompt: testPrompt, localPath: null, fileExtension: '', abortSignal: undefined });
          break;
        case 'openai':
          result = await callOpenAIAPI({ prompt: testPrompt, abortSignal: undefined });
          break;
        case 'openrouter':
          result = await callOpenRouterAPI({ prompt: testPrompt, localPath: null, fileExtension: '', abortSignal: undefined });
          break;
        case 'anthropic':
          result = await callAnthropicAPI({ prompt: testPrompt, abortSignal: undefined });
          break;
        case 'gemini':
          result = await callGeminiAPI({ prompt: testPrompt, abortSignal: undefined });
          break;
        case 'deepseek':
          result = await callDeepSeekAPI({ prompt: testPrompt, abortSignal: undefined });
          break;
      }

      if (typeof result === 'string' && result.toLowerCase().includes('ok')) {
        debugLog(`AI provider (${provider}) connection successful!`);
        aiRenamingPossible = true;
      } else if (result === 'rate-limited') {
        debugLog(`AI provider (${provider}) returned rate limit during verification`);
        aiRenamingPossible = false;
      } else {
        debugLog(`AI provider (${provider}) connection test did not succeed`);
        aiRenamingPossible = false;
      }
    } catch (e) {
      console.error("Error verifying AI provider connection:", e);
      aiRenamingPossible = false;
    }
  }

  // Function to cancel AI process for a specific download
  async function cancelAIProcessForDownload(downloadKey) {
    const aiProcess = activeAIProcesses.get(downloadKey);
    if (!aiProcess) {
      debugLog(`[AI Cancel] No active AI process found for ${downloadKey}`);
      return false;
    }
    
    debugLog(`[AI Cancel] Canceling AI process for ${downloadKey}`, {
      phase: aiProcess.processState.phase,
      duration: Date.now() - aiProcess.startTime
    });
    
    try {
      // Abort the process
      aiProcess.abortController.abort();
      
      // Clean up the process tracking
      activeAIProcesses.delete(downloadKey);
      
      // Clean up UI state
      const cardData = activeDownloadCards.get(downloadKey);
      if (cardData?.podElement) {
        cardData.podElement.classList.remove("renaming-active");
        cardData.podElement.classList.remove("renaming-initiated");
      }
      
      // Update status if this is the focused download
      if (downloadKey === focusedDownloadKey && masterTooltipDOMElement) {
        const statusEl = masterTooltipDOMElement.querySelector(".card-status");
        if (statusEl && (statusEl.textContent.includes("Analyzing") || statusEl.textContent.includes("Generating"))) {
          // Restore appropriate status based on download state
          const download = cardData?.download;
          if (download?.succeeded) {
            statusEl.textContent = "Download completed";
            statusEl.style.color = "#1dd1a1";
          } else if (download?.error) {
            statusEl.textContent = `Error: ${download.error.message || "Download failed"}`;
            statusEl.style.color = "#ff6b6b";
          } else if (download?.canceled) {
            statusEl.textContent = "Download canceled";
            statusEl.style.color = "#ff9f43";
          }
        }
      }
      
      debugLog(`[AI Cancel] Successfully canceled AI process for ${downloadKey}`);
      return true;
      
    } catch (error) {
      debugLog(`[AI Cancel] Error canceling AI process for ${downloadKey}:`, error);
      // Still clean up tracking even if abort failed
      activeAIProcesses.delete(downloadKey);
      return false;
    }
  }

  // Final safety check before declaring success
  if (cssStylesAvailable) {
    console.log("=== DOWNLOAD PREVIEW SCRIPT LOADED SUCCESSFULLY ===");
  } else {
    console.log("=== DOWNLOAD PREVIEW SCRIPT LOADED BUT DISABLED (CSS MISSING) ===");
  }

// --- Sidebar Width Synchronization Logic ---
function updateCurrentZenSidebarWidth() {
  const mainWindow = document.getElementById('main-window');
  const toolbox = document.getElementById('navigator-toolbox');

  if (!toolbox) {
    debugLog('[SidebarWidthSync] #navigator-toolbox not found. Cannot read --zen-sidebar-width.');
    // currentZenSidebarWidth = ''; // Let it retain its value if toolbox temporarily disappears? Or clear?
                                 // For now, if toolbox isn't there, we can't update, so we do nothing to the existing value.
    return;
  }

  // Log compact mode for context, but don't block the read based on it.
  if (mainWindow) {
    const isCompact = mainWindow.getAttribute('zen-compact-mode') === 'true';
    debugLog(`[SidebarWidthSync] #main-window zen-compact-mode is currently: ${isCompact}. Attempting to read from #navigator-toolbox.`);
  } else {
    debugLog('[SidebarWidthSync] #main-window not found. Attempting to read from #navigator-toolbox.');
  }
  
  const value = getComputedStyle(toolbox).getPropertyValue('--zen-sidebar-width').trim();
  
  if (value && value !== "0px" && value !== "") {
    if (currentZenSidebarWidth !== value) {
      currentZenSidebarWidth = value;
      debugLog('[SidebarWidthSync] Updated currentZenSidebarWidth from #navigator-toolbox to:', value);
      applyGlobalWidthToAllTooltips(); // Apply to existing tooltips
    } else {
      debugLog('[SidebarWidthSync] --zen-sidebar-width from #navigator-toolbox is unchanged (' + value + '). No update to tooltips needed.');
    }
  } else {
    // If the value is empty, "0px", or not set, it implies the sidebar isn't in a state where this var is active.
    // Clear our global var so the tooltip uses its own default width.
    if (currentZenSidebarWidth !== '') { // Only update if it actually changes to empty
      currentZenSidebarWidth = ''; 
      debugLog(`[SidebarWidthSync] --zen-sidebar-width on #navigator-toolbox is '${value}'. Cleared currentZenSidebarWidth. Tooltip will use default width.`);
      applyGlobalWidthToAllTooltips(); // Apply default width logic to existing tooltips
    } else {
      debugLog(`[SidebarWidthSync] --zen-sidebar-width on #navigator-toolbox is '${value}' and currentZenSidebarWidth is already empty. No update needed.`);
    }
  }
}

function initSidebarWidthSync() {
  const mainWindow = document.getElementById('main-window');
  const navigatorToolbox = document.getElementById('navigator-toolbox');
  let resizeTimeoutId = null;

  if (mainWindow) {
    // Set up a MutationObserver to watch attribute changes on #main-window for zen-compact-mode
    const mutationObserver = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'zen-compact-mode'
        ) {
          debugLog('[SidebarWidthSync] zen-compact-mode attribute changed. Updating sidebar width.');
          updateCurrentZenSidebarWidth();
        }
      }
    });
    mutationObserver.observe(mainWindow, {
      attributes: true,
      attributeFilter: ['zen-compact-mode']
    });
  } else {
    debugLog('[SidebarWidthSync] initSidebarWidthSync: #main-window not found. Cannot set up MutationObserver for compact mode.');
  }

  if (navigatorToolbox) {
    // Set up a ResizeObserver to watch for size changes on #navigator-toolbox
    const resizeObserver = new ResizeObserver(entries => {
      // Debounce the resize event
      clearTimeout(resizeTimeoutId);
      resizeTimeoutId = setTimeout(() => {
        for (let entry of entries) {
          // We don't strictly need to check entry.contentRect here as getComputedStyle will get the current var value
          debugLog('[SidebarWidthSync] #navigator-toolbox resized. Updating sidebar width.');
          updateCurrentZenSidebarWidth();
        }
      }, 250); // 250ms debounce period
    });
    resizeObserver.observe(navigatorToolbox);
    debugLog('[SidebarWidthSync] ResizeObserver started on #navigator-toolbox.');
  } else {
    debugLog('[SidebarWidthSync] initSidebarWidthSync: #navigator-toolbox not found. Cannot set up ResizeObserver.');
  }

  // Run it once at init in case the attribute/size is already set at load
  debugLog('[SidebarWidthSync] Initial call to update sidebar width.');
  updateCurrentZenSidebarWidth();
}

function applyGlobalWidthToAllTooltips() {
  debugLog('[TooltipWidth] Attempting to apply global width to master tooltip.');
  if (!masterTooltipDOMElement) {
    debugLog('[TooltipWidth] Master tooltip DOM element not found.');
    return;
  }

  if (currentZenSidebarWidth && currentZenSidebarWidth !== "0px" && !isNaN(parseFloat(currentZenSidebarWidth))) {
    const newWidth = `calc(${currentZenSidebarWidth} - 20px)`; 
    masterTooltipDOMElement.style.width = newWidth;
    debugLog(`[TooltipWidth] Applied new width to master tooltip: ${newWidth}`);
  } else {
    // Fallback to default width if currentZenSidebarWidth is invalid or not set
    masterTooltipDOMElement.style.width = '350px'; // Default width
    debugLog('[TooltipWidth] Applied default width (350px) to master tooltip as currentZenSidebarWidth is invalid or empty.');
  }
}

// --- Zen Animation Synchronization Logic ---
function triggerCardEntrance(downloadKeyToTrigger) {
  const cardData = activeDownloadCards.get(downloadKeyToTrigger);
  if (!cardData) {
    debugLog(`[ZenSync] triggerCardEntrance: No cardData for key ${downloadKeyToTrigger}`);
    return;
  }

  // This function is now primarily a signal that Zen animation (if any) is complete.
  // It no longer appends or directly animates the pod here.
  // It marks the pod as ready for layout and calls updateUIForFocusedDownload.
  
  if (cardData.isWaitingForZenAnimation) {
    debugLog(`[ZenSync] triggerCardEntrance: Zen animation completed or fallback for ${downloadKeyToTrigger}. Pod is ready for layout.`);
    cardData.isWaitingForZenAnimation = false;
    
    // Ensure the pod is appended to DOM if it hasn't been already
    if (!cardData.domAppended && podsRowContainerElement && cardData.podElement) {
        podsRowContainerElement.appendChild(cardData.podElement);
        cardData.domAppended = true;
        debugLog(`[ZenSync] Appended pod ${downloadKeyToTrigger} to DOM after Zen animation.`);
    }
    
    // Call updateUI which will call managePodVisibilityAndAnimations
    // If this download is the new focus, it makes sense to update everything.
    // If not, we still need to re-evaluate layout for all pods.
    updateUIForFocusedDownload(focusedDownloadKey || downloadKeyToTrigger, false); 
  } else {
    debugLog(`[ZenSync] triggerCardEntrance: Called for ${downloadKeyToTrigger} but it was not waiting for Zen animation. Ignoring.`);
  }
}

function initZenAnimationObserver(downloadKey, podElementToMonitor) { // podElement is passed for context, not direct manipulation here
  debugLog("[ZenSync] Initializing observer for key:", downloadKey);
  let observer = null;
  let fallbackTimeoutId = null;

  const zenAnimationHost = document.querySelector('zen-download-animation');

  if (zenAnimationHost && zenAnimationHost.shadowRoot) {
    debugLog("[ZenSync] Found zen-download-animation host and shadowRoot.");

    observer = new MutationObserver((mutationsList, obs) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          for (const removedNode of mutation.removedNodes) {
            if (removedNode.nodeType === Node.ELEMENT_NODE && removedNode.classList.contains('zen-download-arc-animation')) {
              debugLog("[ZenSync] Detected .zen-download-arc-animation removal. Triggering pod entrance.", { key: downloadKey });
              clearTimeout(fallbackTimeoutId); // Clear the safety fallback
              triggerCardEntrance(downloadKey, podElementToMonitor);
              obs.disconnect(); // Stop observing
              observer = null; // Clean up observer reference
              return; // Exit once detected
            }
          }
        }
      }
    });

    observer.observe(zenAnimationHost.shadowRoot, { childList: true });
    debugLog("[ZenSync] Observer started on shadowRoot.");

    // Safety fallback timeout
    fallbackTimeoutId = setTimeout(() => {
      debugLog("[ZenSync] Fallback timeout reached. Triggering card entrance signal.", { key: downloadKey });
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      triggerCardEntrance(downloadKey); 
      // CardData fallbackTriggered is not strictly needed now as triggerCardEntrance is just a signal
    }, 3000); // 3-second fallback

  } else {
    debugLog("[ZenSync] zen-download-animation host or shadowRoot not found. Triggering card entrance signal immediately.", { key: downloadKey });
    triggerCardEntrance(downloadKey);
    // CardData fallbackTriggered not strictly needed
  }
}

// --- Function to Undo AI Rename ---
async function undoRename(keyOfAIRenamedFile) {
  debugLog("[UndoRename] Attempting to undo rename for key:", keyOfAIRenamedFile);
  const cardData = activeDownloadCards.get(keyOfAIRenamedFile);

  if (!cardData || !cardData.download) {
      debugLog("[UndoRename] No cardData or download object found for key:", keyOfAIRenamedFile);
      return false;
  }

  const currentAIRenamedPath = cardData.download.target.path; // Current path (after AI rename)
  const originalSimpleName = cardData.trueOriginalSimpleNameBeforeAIRename;
  const originalFullPath = cardData.trueOriginalPathBeforeAIRename; // The full path before AI rename

  if (!currentAIRenamedPath || !originalSimpleName || !originalFullPath) {
      debugLog("[UndoRename] Missing path/name information for undo:", 
          { currentAIRenamedPath, originalSimpleName, originalFullPath });
      // Maybe update status to indicate error?
      return false;
  }
  
  // Ensure originalSimpleName is what we expect if originalFullPath is the key to the past state
  // For safety, we reconstruct the target directory from the *current* path if the original was just a simple name.
  const targetDirectory = currentAIRenamedPath.substring(0, currentAIRenamedPath.lastIndexOf(PATH_SEPARATOR));
  const targetOriginalPath = targetDirectory + PATH_SEPARATOR + originalSimpleName;

  debugLog("[UndoRename] Details:", {
      currentPath: currentAIRenamedPath,
      originalSimple: originalSimpleName,
      originalFullPathStored: originalFullPath, // The key to what it *was*
      targetOriginalPathForRename: targetOriginalPath // The path we want to rename *to*
  });

  // Use a modified version of rename logic. 
  // We are renaming from currentAIRenamedPath to targetOriginalPath (which uses originalSimpleName)
  try {
      const fileToUndo = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      fileToUndo.initWithPath(currentAIRenamedPath);

      if (!fileToUndo.exists()) {
          debugLog("[UndoRename] File to undo does not exist at current path:", currentAIRenamedPath);
          // Perhaps it was moved or deleted by the user? Clean up UI.
          if (masterTooltipDOMElement) {
              const undoBtn = masterTooltipDOMElement.querySelector(".card-undo-button");
              if (undoBtn) undoBtn.style.display = "none";
          }
          // Consider removing the card or updating status more drastically.
          return false;
      }

      // Perform the rename back to originalSimpleName in the current directory
      fileToUndo.moveTo(null, originalSimpleName); 
      debugLog(`[UndoRename] File moved from ${currentAIRenamedPath} to ${targetOriginalPath} (using simple name ${originalSimpleName})`);

      // Update download object and cardData
      cardData.download.target.path = targetOriginalPath;
      cardData.download.aiName = null; // Clear the AI name
      // cardData.originalFilename should revert to originalSimpleName (or be updated by next UI refresh)
      cardData.originalFilename = originalSimpleName; 

      // Update the key in activeDownloadCards map
      if (keyOfAIRenamedFile !== targetOriginalPath) {
          activeDownloadCards.delete(keyOfAIRenamedFile);
          activeDownloadCards.set(targetOriginalPath, cardData);
          cardData.key = targetOriginalPath;
          if (cardData.podElement) cardData.podElement.dataset.downloadKey = targetOriginalPath;
          
          // Update orderedPodKeys
          const oldKeyIndex = orderedPodKeys.indexOf(keyOfAIRenamedFile);
          if (oldKeyIndex > -1) {
              orderedPodKeys.splice(oldKeyIndex, 1, targetOriginalPath);
          }

          // If this was the focused key, update focusedDownloadKey
          if (focusedDownloadKey === keyOfAIRenamedFile) {
              focusedDownloadKey = targetOriginalPath;
          }
          debugLog(`[UndoRename] Updated activeDownloadCards map key from ${keyOfAIRenamedFile} to ${targetOriginalPath}`);
      }
      
      renamedFiles.delete(originalFullPath); // Allow AI re-rename if user downloads it again or wants to retry
      renamedFiles.delete(currentAIRenamedPath); // Remove the AI-renamed path from the set too

      // Update UI immediately for the focused item
      if (focusedDownloadKey === targetOriginalPath && masterTooltipDOMElement) {
          const titleEl = masterTooltipDOMElement.querySelector(".card-title");
          const statusEl = masterTooltipDOMElement.querySelector(".card-status");
          const originalFilenameEl = masterTooltipDOMElement.querySelector(".card-original-filename");
          const progressEl = masterTooltipDOMElement.querySelector(".card-progress");
          const undoBtn = masterTooltipDOMElement.querySelector(".card-undo-button");

          if (titleEl) titleEl.textContent = originalSimpleName;
          if (statusEl) {
              statusEl.textContent = "Download completed"; // Or original status if stored
              statusEl.style.color = "#1dd1a1";
          }
          if (originalFilenameEl) originalFilenameEl.style.display = "none";
          if (progressEl) progressEl.style.display = "block"; // Show progress/size again
          if (undoBtn) undoBtn.style.display = "none";
      }

      // Trigger a full UI update
      updateUIForFocusedDownload(focusedDownloadKey || targetOriginalPath, true); 

      debugLog("[UndoRename] Rename undone successfully.");
      return true;

  } catch (e) {
      debugLog("[UndoRename] Error during undo rename process:", e);
      // Update status to show error?
      if (masterTooltipDOMElement && focusedDownloadKey === keyOfAIRenamedFile) {
           const statusEl = masterTooltipDOMElement.querySelector(".card-status");
           if (statusEl) {
              statusEl.textContent = "Undo rename failed";
              statusEl.style.color = "#ff6b6b";
           }
      }
      return false;
  }
}

  } // Close initializeMainScript function

})(); //Test Comment again again x3
