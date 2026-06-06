/* ============================================================
   Diet Monitor — app.js
   Handles:
     1. Weekly calendar strip (fetches /api/week-status)
     2. Log page: meal type pills, voice input, cart, Save All
     3. Profile page: form submit, suggested goals, weight logging
     4. Toast notifications (global, reusable)
     5. Delete food log entries
   ============================================================ */

'use strict';

// ── Utility: HTML escape ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
(function initToast() {
  window.showToast = function showToast(msg, isError) {
    // Prefer the global toast in base.html; fall back to local #toast if present
    var el = document.getElementById('global-toast') || document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? 'rgba(185,28,28,0.9)' : 'rgba(13,24,41,0.95)';
    el.style.borderColor = isError ? 'rgba(248,113,113,0.4)' : 'rgba(59,130,246,0.3)';
    el.classList.remove('opacity-0');
    el.classList.add('opacity-100');
    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(function () {
      el.classList.remove('opacity-100');
      el.classList.add('opacity-0');
    }, 2600);
  };
})();

// ── Log page ──────────────────────────────────────────────────────────────────
(function initLogPage() {
  var searchInput      = document.getElementById('search-input');
  if (!searchInput) return;  // not on log page

  var searchResults    = document.getElementById('search-results');
  var searchSpinner    = document.getElementById('search-spinner');
  var divider          = document.getElementById('divider');
  var logFormSection   = document.getElementById('log-form-section');
  var selectedFoodName = document.getElementById('selected-food-name');
  var selectedFoodMacros = document.getElementById('selected-food-macros');
  var gramsInput       = document.getElementById('grams-input');
  var addToCartBtn     = document.getElementById('add-to-cart-btn');
  var cancelBtn        = document.getElementById('cancel-btn');
  var cartSection      = document.getElementById('cart-section');
  var cartList         = document.getElementById('cart-list');
  var cartCalTotal     = document.getElementById('cart-calorie-total');
  var saveAllBtn       = document.getElementById('save-all-btn');
  var voiceBtn         = document.getElementById('voice-btn');
  var micIcon          = document.getElementById('mic-icon');
  var micRecording     = document.getElementById('mic-recording');
  var voiceUnsupported = document.getElementById('voice-unsupported');
  var scanBtn          = document.getElementById('scan-btn');
  var imageInput       = document.getElementById('image-input');
  var ocrResult        = document.getElementById('ocr-result');
  var ocrResultOutput  = document.getElementById('ocr-result-output');
  var unitSelector     = document.getElementById('unit-selector');
  var amountLabel      = document.getElementById('amount-label');

  // Preview elements
  var prevCal   = document.getElementById('prev-cal');
  var prevProt  = document.getElementById('prev-prot');
  var prevCarbs = document.getElementById('prev-carbs');
  var prevFat   = document.getElementById('prev-fat');

  // ── State ──────────────────────────────────────────────────
  var selectedFood  = null;   // { name, kcal, protein, carbs, fat }
  var debounceTimer = null;
  var cart          = [];     // [{ food, grams, meal_type, calories, protein, carbs, fat }]
  var activeMealType = 'snacks';

  // ── Meal type pills ────────────────────────────────────────
  var mealPills = document.querySelectorAll('.meal-pill');

  function setActiveMeal(meal) {
    activeMealType = meal;
    mealPills.forEach(function (pill) {
      var isActive = pill.dataset.meal === meal;
      pill.classList.toggle('border-blue-500',  isActive);
      pill.classList.toggle('text-blue-300',    isActive);
      pill.classList.toggle('border-slate-700', !isActive);
      pill.classList.toggle('text-slate-400',   !isActive);
    });
  }

  // Read meal from URL ?meal=xxx
  var urlParams = new URLSearchParams(window.location.search);
  var initialMeal = urlParams.get('meal') || 'snacks';
  setActiveMeal(initialMeal);

  mealPills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      setActiveMeal(pill.dataset.meal);
    });
  });

  // ── Search ─────────────────────────────────────────────────
  searchInput.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = searchInput.value.trim();
    if (q.length < 2) { clearResults(); return; }
    debounceTimer = setTimeout(function () { doSearch(q); }, 400);
  });

  async function doSearch(q) {
    showSpinner(true);
    clearResults();
    clearOcrResult();
    try {
      var res  = await fetch('/api/search?q=' + encodeURIComponent(q));
      var data = await res.json();
      renderResults(data.results || [], data.error);
    } catch (e) {
      renderError('Network error — please check your connection.');
    } finally {
      showSpinner(false);
    }
  }

  if (scanBtn && imageInput) {
    scanBtn.addEventListener('click', function () {
      imageInput.click();
    });

    imageInput.addEventListener('change', async function () {
      var file = imageInput.files && imageInput.files[0];
      if (!file) return;

      clearResults();
      clearOcrResult();
      showSpinner(true);

      var form = new FormData();
      form.append('file', file);

      try {
        var res = await fetch('/api/ocr-image', {
          method: 'POST',
          body: form,
        });

        if (!res.ok) {
          var errorBody = await res.json().catch(function () { return null; });
          renderError(errorBody && errorBody.detail ? errorBody.detail : 'Unable to parse image.');
          return;
        }

        var data = await res.json();
        renderOcrResult(data.parsed || {}, data.text || '');
      } catch (e) {
        renderError('Image upload failed. Please try again.');
      } finally {
        showSpinner(false);
      }
    });
  }

  function renderResults(results, errorMsg) {
    searchResults.innerHTML = '';

    if (errorMsg && results.length === 0) {
      renderError('Food search is temporarily unavailable. Try again shortly.');
      return;
    }
    if (results.length === 0) {
      searchResults.innerHTML =
        '<div class="text-center py-8 text-slate-500 text-sm">' +
        '<p class="text-2xl mb-2">🔍</p>' +
        '<p>No results found. Try a different search term.</p></div>';
      return;
    }

    results.forEach(function (food) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = [
        'w-full text-left rounded-xl px-4 py-3.5',
        'hover:border-blue-500/60 active:opacity-80',
        'transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/50',
      ].join(' ');
      card.style.cssText = 'background:#0d1829; border:1px solid rgba(255,255,255,0.07);';
      card.innerHTML =
        '<p class="font-medium text-slate-200 text-sm leading-snug">' + escHtml(food.name) + '</p>' +
        '<div class="flex gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">' +
        '<span class="text-blue-400 font-semibold">' + food.kcal + ' kcal</span>' +
        '<span>P: ' + food.protein + 'g</span>' +
        '<span>C: ' + food.carbs + 'g</span>' +
        '<span>F: ' + food.fat + 'g</span>' +
        '<span class="text-slate-600">per ' + (food.unit_label || '100g') + '</span></div>';
      card.addEventListener('click', function () { selectFood(food); });
      searchResults.appendChild(card);
    });
  }

  function renderError(msg) {
    searchResults.innerHTML =
      '<div class="text-rose-400 text-sm rounded-xl px-4 py-3" style="background:rgba(251,113,133,0.08);border:1px solid rgba(251,113,133,0.2)">' +
      escHtml(msg) + '</div>';
  }

  function renderOcrResult(parsed, rawText) {
    if (!ocrResult || !ocrResultOutput) return;
    ocrResultOutput.innerHTML = '';
    var title = document.createElement('p');
    title.className = 'text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2';
    title.textContent = 'Recognized text';
    ocrResultOutput.appendChild(title);

    var textBlock = document.createElement('pre');
    textBlock.className = 'whitespace-pre-wrap text-xs leading-5 rounded-xl p-3 text-slate-300';
    textBlock.style.cssText = 'background:#081220; border:1px solid rgba(255,255,255,0.07)';
    textBlock.textContent = rawText.trim() || 'No text detected.';
    ocrResultOutput.appendChild(textBlock);

    if (parsed && parsed.food_name) {
      var parsedBlock = document.createElement('div');
      parsedBlock.className = 'mt-3 space-y-1';
      parsedBlock.innerHTML =
        '<p class="font-semibold text-slate-100">Parsed product</p>' +
        '<p class="text-sm text-slate-400">' + escHtml(parsed.food_name) + '</p>' +
        '<div class="flex flex-wrap gap-2 text-xs text-slate-400">' +
        '<span class="px-2 py-1 rounded-full" style="background:#0d2040">' + parsed.calories_per_100g + ' kcal/100g</span>' +
        '<span class="px-2 py-1 rounded-full" style="background:#0d2040">P ' + parsed.protein_per_100g + 'g</span>' +
        '<span class="px-2 py-1 rounded-full" style="background:#0d2040">C ' + parsed.carbs_per_100g + 'g</span>' +
        '<span class="px-2 py-1 rounded-full" style="background:#0d2040">F ' + parsed.fat_per_100g + 'g</span>' +
        '</div>';
      ocrResultOutput.appendChild(parsedBlock);
    }

    var actionBlock = document.createElement('div');
    actionBlock.className = 'mt-3 flex gap-2 flex-wrap';

    var useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'px-4 py-2 rounded-xl text-white text-sm font-semibold';
    useBtn.style.cssText = 'background:linear-gradient(135deg,#1d4ed8,#3b82f6)';
    useBtn.textContent = 'Use scanned product';
    useBtn.addEventListener('click', function () {
      if (parsed && parsed.food_name) {
        selectFood({
          name: parsed.food_name,
          kcal: parsed.calories_per_100g,
          protein: parsed.protein_per_100g,
          carbs: parsed.carbs_per_100g,
          fat: parsed.fat_per_100g,
        });
        ocrResult.classList.add('hidden');
      }
    });
    actionBlock.appendChild(useBtn);

    if (parsed && parsed.food_name) {
      var searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.className = 'px-4 py-2 rounded-xl text-slate-300 text-sm hover:text-white transition-colors';
      searchBtn.style.cssText = 'background:#0d1829; border:1px solid rgba(255,255,255,0.1)';
      searchBtn.textContent = 'Search product name';
      searchBtn.addEventListener('click', function () {
        searchInput.value = parsed.food_name;
        searchInput.dispatchEvent(new Event('input'));
      });
      actionBlock.appendChild(searchBtn);
    }

    ocrResultOutput.appendChild(actionBlock);
    ocrResult.classList.remove('hidden');
  }

  function clearOcrResult() {
    if (!ocrResult) return;
    ocrResult.classList.add('hidden');
    if (ocrResultOutput) ocrResultOutput.innerHTML = '';
  }

  function clearResults() { searchResults.innerHTML = ''; }
  function showSpinner(show) { searchSpinner.classList.toggle('hidden', !show); }

  // ── Food selection ─────────────────────────────────────────
  function selectFood(food) {
    selectedFood = food;
    selectedFoodName.textContent = food.name;
    
    var unitLabel = food.unit_label || '100g';
    selectedFoodMacros.textContent =
      'Per ' + unitLabel + ': ' + food.kcal + ' kcal · P ' + food.protein + 'g · C ' + food.carbs + 'g · F ' + food.fat + 'g';
    
    divider.classList.remove('hidden');
    logFormSection.classList.remove('hidden');
    logFormSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Reset quantity to 1
    gramsInput.value = '1';
    
    // Configure unit selector
    unitSelector.innerHTML = '';
    var unitOption = document.createElement('option');
    unitOption.value = 'unit';
    unitOption.textContent = unitLabel;
    unitSelector.appendChild(unitOption);
    
    var gramsOption = document.createElement('option');
    gramsOption.value = 'g';
    gramsOption.textContent = 'grams';
    unitSelector.appendChild(gramsOption);
    
    unitSelector.value = 'unit';
    
    // Update label to show the actual unit
    if (amountLabel) {
      amountLabel.textContent = 'Amount (' + unitLabel + ')';
    }
    
    updatePreview();
  }

  function deselectFood() {
    selectedFood = null;
    divider.classList.add('hidden');
    logFormSection.classList.add('hidden');
  }

  // ── Macro preview ──────────────────────────────────────────
  gramsInput.addEventListener('input', updatePreview);
  unitSelector.addEventListener('change', updatePreview);

  function updatePreview() {
    if (!selectedFood) return;
    var quantity = parseFloat(gramsInput.value) || 0;
    var selectedUnit = unitSelector.value;
    
    // Convert quantity to grams
    var grams = quantity;
    if (selectedUnit === 'unit' && selectedFood.grams_per_unit && selectedFood.grams_per_unit > 0) {
      grams = quantity * selectedFood.grams_per_unit;
    }
    
    var f = grams / 100;
    prevCal.textContent   = (selectedFood.kcal    * f).toFixed(0) + ' kcal';
    prevProt.textContent  = (selectedFood.protein * f).toFixed(1) + 'g';
    prevCarbs.textContent = (selectedFood.carbs   * f).toFixed(1) + 'g';
    prevFat.textContent   = (selectedFood.fat     * f).toFixed(1) + 'g';
  }

  // ── Cancel ─────────────────────────────────────────────────
  cancelBtn.addEventListener('click', function () {
    deselectFood();
    searchInput.value = '';
    clearResults();
    searchInput.focus();
  });

  // ── Add to cart ─────────────────────────────────────────────
  addToCartBtn.addEventListener('click', function () {
    if (!selectedFood) return;
    var quantity = parseFloat(gramsInput.value);
    if (!quantity || quantity <= 0) {
      gramsInput.focus();
      gramsInput.classList.add('ring-2', 'ring-rose-400');
      setTimeout(function () { gramsInput.classList.remove('ring-2', 'ring-rose-400'); }, 1500);
      return;
    }

    // Convert quantity to grams based on selected unit
    var selectedUnit = unitSelector.value;
    var grams = quantity;
    if (selectedUnit === 'unit' && selectedFood.grams_per_unit && selectedFood.grams_per_unit > 0) {
      grams = quantity * selectedFood.grams_per_unit;
    }

    var f = grams / 100;
    var item = {
      food:      selectedFood,
      grams:     grams,
      meal_type: activeMealType,
      calories:  parseFloat((selectedFood.kcal    * f).toFixed(1)),
      protein:   parseFloat((selectedFood.protein * f).toFixed(1)),
      carbs:     parseFloat((selectedFood.carbs   * f).toFixed(1)),
      fat:       parseFloat((selectedFood.fat     * f).toFixed(1)),
    };

    cart.push(item);
    renderCart();
    deselectFood();
    searchInput.value = '';
    clearResults();
    searchInput.focus();
    showToast('Added to cart!');
  });

  // ── Cart rendering ──────────────────────────────────────────
  function renderCart() {
    if (cart.length === 0) {
      cartSection.classList.add('hidden');
      return;
    }
    cartSection.classList.remove('hidden');

    var totalCal = cart.reduce(function (sum, item) { return sum + item.calories; }, 0);
    cartCalTotal.textContent = Math.round(totalCal) + ' kcal';

    cartList.innerHTML = '';
    cart.forEach(function (item, idx) {
      var li = document.createElement('li');
      li.className = 'px-5 py-3.5 flex items-start justify-between gap-3';
      li.innerHTML =
        '<div class="flex-1 min-w-0">' +
          '<p class="font-medium text-slate-200 truncate text-sm">' + escHtml(item.food.name) + '</p>' +
          '<p class="text-xs text-slate-500 mt-0.5">' + item.grams + 'g · ' + getMealLabel(item.meal_type) + '</p>' +
          '<div class="flex gap-3 mt-1 text-xs text-slate-500">' +
            '<span class="text-blue-400 font-semibold">' + Math.round(item.calories) + ' kcal</span>' +
            '<span>P: ' + item.protein + 'g</span>' +
            '<span>C: ' + item.carbs + 'g</span>' +
            '<span>F: ' + item.fat + 'g</span>' +
          '</div>' +
        '</div>' +
        '<button class="flex-shrink-0 p-2 text-slate-600 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10" ' +
                'aria-label="Remove" data-cart-idx="' + idx + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" ' +
               'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
          '</svg>' +
        '</button>';
      cartList.appendChild(li);
    });

    // Remove buttons
    cartList.querySelectorAll('[data-cart-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.cartIdx, 10);
        cart.splice(idx, 1);
        renderCart();
      });
    });
  }

  function getMealLabel(meal) {
    var labels = { breakfast: '🌅 Breakfast', lunch: '☀️ Lunch', dinner: '🌙 Dinner', snacks: '🍎 Snacks' };
    return labels[meal] || meal;
  }

  // ── Save All ────────────────────────────────────────────────
  saveAllBtn.addEventListener('click', async function () {
    if (cart.length === 0) return;

    saveAllBtn.disabled    = true;
    saveAllBtn.textContent = 'Saving…';

    var errors = 0;
    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      var payload = {
        food_name:         item.food.name,
        calories_per_100g: item.food.kcal,
        protein_per_100g:  item.food.protein,
        carbs_per_100g:    item.food.carbs,
        fat_per_100g:      item.food.fat,
        grams:             item.grams,
        meal_type:         item.meal_type,
      };
      try {
        var res = await fetch('/api/log', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        if (!res.ok) errors++;
      } catch (e) {
        errors++;
      }
    }

    saveAllBtn.disabled    = false;
    saveAllBtn.textContent = 'Save All to Log';

    if (errors === 0) {
      showToast('✅ ' + cart.length + ' item' + (cart.length !== 1 ? 's' : '') + ' saved!');
      cart = [];
      renderCart();
    } else {
      showToast('⚠️ ' + errors + ' item(s) failed to save.', true);
    }
  });

  // ── Voice input ─────────────────────────────────────────────
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRec) {
    voiceBtn.addEventListener('click', function () {
      voiceUnsupported.classList.remove('hidden');
    });
  } else {
    var recognition = new SpeechRec();
    recognition.lang        = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    var isListening = false;

    voiceBtn.addEventListener('click', function () {
      if (isListening) {
        recognition.stop();
        return;
      }
      recognition.start();
    });

    recognition.addEventListener('start', function () {
      isListening = true;
      micIcon.classList.add('hidden');
      micRecording.classList.remove('hidden');
      voiceBtn.classList.add('border-rose-400', 'text-rose-500');
      voiceBtn.classList.remove('border-gray-200', 'text-gray-400');
    });

    recognition.addEventListener('end', function () {
      isListening = false;
      micIcon.classList.remove('hidden');
      micRecording.classList.add('hidden');
      voiceBtn.classList.remove('border-rose-400', 'text-rose-400');
      voiceBtn.classList.add('text-slate-500');
    });

    recognition.addEventListener('result', function (e) {
      var transcript = e.results[0][0].transcript;
      searchInput.value = transcript;
      searchInput.dispatchEvent(new Event('input'));
    });

    recognition.addEventListener('error', function (e) {
      showToast('Voice error: ' + e.error, true);
    });
  }
})();


// ── Profile page ──────────────────────────────────────────────────────────────
(function initProfilePage() {
  var profileForm   = document.getElementById('profile-form');
  if (!profileForm) return;  // not on profile page

  var applyGoalsBtn     = document.getElementById('apply-goals-btn');
  var suggestedContent  = document.getElementById('suggested-goals-content');
  var logWeightBtn      = document.getElementById('log-weight-btn');
  var quickWeightInput  = document.getElementById('quick-weight-input');
  var quickWeightNote   = document.getElementById('quick-weight-note');
  var weightHistoryList = document.getElementById('weight-history-list');
  var weightEmptyState  = document.getElementById('weight-empty-state');

  var suggestedGoals = null;  // stored after profile fetch

  // ── Load suggested goals on page open ──────────────────────
  async function loadSuggestedGoals() {
    try {
      var res  = await fetch('/api/profile');
      var data = await res.json();
      if (data.suggested_goals) {
        renderSuggestedGoals(data.suggested_goals);
      }
    } catch (e) {
      // silent fail
    }
  }

  function renderSuggestedGoals(goals) {
    suggestedGoals = goals;
    if (!suggestedContent) return;
    suggestedContent.innerHTML =
      '<div class="grid grid-cols-2 gap-3">' +
        '<div class="rounded-xl p-3 text-center" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.18)">' +
          '<p class="text-2xl font-bold text-blue-400">' + goals.calories + '</p>' +
          '<p class="text-xs text-slate-500 mt-0.5">Calories</p>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.12)">' +
          '<p class="text-2xl font-bold text-blue-300">' + goals.protein + 'g</p>' +
          '<p class="text-xs text-slate-500 mt-0.5">Protein</p>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.15)">' +
          '<p class="text-2xl font-bold text-amber-400">' + goals.carbs + 'g</p>' +
          '<p class="text-xs text-slate-500 mt-0.5">Carbs</p>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:rgba(251,113,133,0.08);border:1px solid rgba(251,113,133,0.15)">' +
          '<p class="text-2xl font-bold text-rose-400">' + goals.fat + 'g</p>' +
          '<p class="text-xs text-slate-500 mt-0.5">Fat</p>' +
        '</div>' +
      '</div>';

    if (applyGoalsBtn) applyGoalsBtn.classList.remove('hidden');
  }

  loadSuggestedGoals();

  // ── Apply Goals ────────────────────────────────────────────
  if (applyGoalsBtn) {
    applyGoalsBtn.addEventListener('click', async function () {
      if (!suggestedGoals) return;
      try {
        var res = await fetch('/api/goals', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(suggestedGoals),
        });
        if (res.ok) {
          showToast('✅ Goals updated!');
        } else {
          showToast('❌ Could not update goals.', true);
        }
      } catch (e) {
        showToast('❌ Network error.', true);
      }
    });
  }

  // ── Profile form submit ────────────────────────────────────
  profileForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(profileForm);

    var payload = {
      height_cm:  parseFloatOrNull(fd.get('height_cm')),
      weight_kg:  parseFloatOrNull(fd.get('weight_kg')),
      age:        parseIntOrNull(fd.get('age')),
      gender:     fd.get('gender') || null,
      activity:   fd.get('activity') || null,
      log_weight: document.getElementById('log-weight-toggle').checked,
    };

    var submitBtn = profileForm.querySelector('[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Saving…';

    try {
      var res  = await fetch('/api/profile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      var data = await res.json();

      if (res.ok) {
        showToast('✅ Profile saved!');
        if (data.suggested_goals) {
          renderSuggestedGoals(data.suggested_goals);
        }
      } else {
        showToast('❌ Could not save profile.', true);
      }
    } catch (ex) {
      showToast('❌ Network error.', true);
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Save Profile';
    }
  });

  // ── Quick weight log ───────────────────────────────────────
  if (logWeightBtn) {
    logWeightBtn.addEventListener('click', async function () {
      var kg   = parseFloat(quickWeightInput.value);
      var note = quickWeightNote ? quickWeightNote.value.trim() : '';

      if (!kg || kg <= 0) {
        quickWeightInput.focus();
        quickWeightInput.classList.add('ring-2', 'ring-rose-400');
        setTimeout(function () { quickWeightInput.classList.remove('ring-2', 'ring-rose-400'); }, 1500);
        return;
      }

      logWeightBtn.disabled    = true;
      logWeightBtn.textContent = '…';

      try {
        var res = await fetch('/api/weight', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ weight_kg: kg, note: note }),
        });
        if (res.ok) {
          showToast('✅ Weight logged!');
          quickWeightInput.value = '';
          if (quickWeightNote) quickWeightNote.value = '';
          refreshWeightHistory();
        } else {
          showToast('❌ Could not log weight.', true);
        }
      } catch (ex) {
        showToast('❌ Network error.', true);
      } finally {
        logWeightBtn.disabled    = false;
        logWeightBtn.textContent = 'Log';
      }
    });
  }

  async function refreshWeightHistory() {
    try {
      var res  = await fetch('/api/weight/history?days=30');
      var data = await res.json();
      var entries = data.history || [];
      renderWeightHistory(entries);
    } catch (e) {
      // silent fail
    }
  }

  function renderWeightHistory(entries) {
    if (!weightHistoryList && !weightEmptyState) return;

    if (entries.length === 0) {
      if (weightHistoryList) weightHistoryList.innerHTML = '';
      if (weightEmptyState)  weightEmptyState.classList.remove('hidden');
      return;
    }

    if (weightEmptyState) weightEmptyState.classList.add('hidden');

    var weights  = entries.map(function (e) { return e.weight_kg; });
    var minW     = Math.min.apply(null, weights);
    var maxW     = Math.max.apply(null, weights);
    var wRange   = maxW !== minW ? maxW - minW : 1;

    var html = '';
    var shown = entries.slice(0, 10);
    shown.forEach(function (entry) {
      var barPct = ((entry.weight_kg - minW) / wRange * 60 + 30).toFixed(1);
      html +=
        '<li class="flex items-center gap-3">' +
          '<div class="w-16 text-right flex-shrink-0">' +
            '<p class="text-xs text-slate-500">' + escHtml(entry.date) + '</p>' +
          '</div>' +
          '<div class="flex-1">' +
            '<div class="relative h-6 flex items-center">' +
              '<div class="h-4 rounded-full" style="width:' + barPct + '%;background:rgba(59,130,246,0.25)"></div>' +
              '<span class="absolute left-2 text-xs font-semibold text-blue-400">' + entry.weight_kg + 'kg</span>' +
            '</div>' +
            (entry.note ? '<p class="text-xs text-slate-500 mt-0.5">' + escHtml(entry.note) + '</p>' : '') +
          '</div>' +
        '</li>';
    });

    if (weightHistoryList) {
      weightHistoryList.innerHTML = html;
    } else {
      // If the list doesn't exist yet (empty state was showing), create it
      var container = document.querySelector('#weight-empty-state').parentElement;
      var ul = document.createElement('ul');
      ul.id = 'weight-history-list';
      ul.className = 'space-y-2';
      ul.innerHTML = html;
      container.appendChild(ul);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function parseFloatOrNull(v) {
    var f = parseFloat(v);
    return isNaN(f) ? null : f;
  }
  function parseIntOrNull(v) {
    var i = parseInt(v, 10);
    return isNaN(i) ? null : i;
  }
})();


// ── Delete log (dashboard) ────────────────────────────────────────────────────
// Exposed as global for inline onclick in index.html
window.deleteLog = async function deleteLog(id) {
  if (!confirm('Remove this entry?')) return;
  try {
    var res = await fetch('/api/log/' + id, { method: 'DELETE' });
    if (res.ok) {
      var el = document.getElementById('log-' + id);
      if (el) el.remove();
      window.location.reload();
    } else {
      showToast('❌ Could not delete entry.', true);
    }
  } catch (e) {
    showToast('❌ Network error.', true);
  }
};
