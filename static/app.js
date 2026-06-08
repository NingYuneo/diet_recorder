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
      var customBadge = food.custom
        ? '<span class="ml-1 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full" style="background:rgba(59,130,246,0.2);color:#60a5fa">★ My Food</span>'
        : '';
      card.innerHTML =
        '<div class="flex items-center gap-1">' +
        '<p class="font-medium text-slate-200 text-sm leading-snug">' + escHtml(food.name) + '</p>' +
        customBadge + '</div>' +
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
  window._selectFood = selectFood;
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

  // ── Manual goals inputs ────────────────────────────────────
  var saveGoalsBtn    = document.getElementById('save-goals-btn');
  var goalCalInput    = document.getElementById('goal-calories');
  var goalProtInput   = document.getElementById('goal-protein');
  var goalCarbsInput  = document.getElementById('goal-carbs');
  var goalFatInput    = document.getElementById('goal-fat');

  async function loadCurrentGoals() {
    try {
      var res  = await fetch('/api/today');
      var data = await res.json();
      var g    = data.goals || {};
      if (goalCalInput   && g.calories != null) goalCalInput.value   = g.calories;
      if (goalProtInput  && g.protein  != null) goalProtInput.value  = g.protein;
      if (goalCarbsInput && g.carbs    != null) goalCarbsInput.value = g.carbs;
      if (goalFatInput   && g.fat      != null) goalFatInput.value   = g.fat;
    } catch (e) {}
  }

  if (saveGoalsBtn) {
    saveGoalsBtn.addEventListener('click', async function () {
      var calories = parseFloat(goalCalInput.value);
      var protein  = parseFloat(goalProtInput.value);
      var carbs    = parseFloat(goalCarbsInput.value);
      var fat      = parseFloat(goalFatInput.value);

      if ([calories, protein, carbs, fat].some(isNaN)) {
        showToast('Please fill in all four goal fields.', true);
        return;
      }

      saveGoalsBtn.disabled    = true;
      saveGoalsBtn.textContent = 'Saving…';

      try {
        var res = await fetch('/api/goals', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ calories, protein, carbs, fat }),
        });
        if (res.ok) {
          showToast('✅ Goals saved!');
        } else {
          showToast('❌ Could not save goals.', true);
        }
      } catch (e) {
        showToast('❌ Network error.', true);
      } finally {
        saveGoalsBtn.disabled    = false;
        saveGoalsBtn.textContent = 'Save Goals';
      }
    });
  }

  loadCurrentGoals();

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


// ── Weight chart (profile page) ──────────────────────────────────────────────
(function initWeightChart() {
  var svg         = document.getElementById('weight-chart');
  var emptyState  = document.getElementById('weight-empty-state');
  var rangeBtns   = document.querySelectorAll('.chart-range-btn');
  if (!svg) return;

  var activeDays = 30;

  rangeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      rangeBtns.forEach(function (b) {
        b.classList.remove('border-blue-500', 'text-blue-300');
        b.classList.add('border-slate-700', 'text-slate-500');
      });
      btn.classList.add('border-blue-500', 'text-blue-300');
      btn.classList.remove('border-slate-700', 'text-slate-500');
      activeDays = parseInt(btn.dataset.days, 10);
      loadChart(activeDays);
    });
  });

  async function loadChart(days) {
    try {
      var res  = await fetch('/api/weight/history?days=' + days);
      var data = await res.json();
      var entries = (data.history || []).slice().reverse(); // oldest first
      renderChart(entries);
    } catch (e) {}
  }

  function renderChart(entries) {
    svg.innerHTML = '';
    if (entries.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    var W = 320, H = 160;
    var pad = { top: 18, right: 16, bottom: 36, left: 44 };
    var cw = W - pad.left - pad.right;
    var ch = H - pad.top - pad.bottom;

    var weights = entries.map(function (e) { return e.weight_kg; });
    var minW = Math.min.apply(null, weights);
    var maxW = Math.max.apply(null, weights);
    var wRange = maxW - minW < 1 ? 2 : maxW - minW;
    var wPad   = wRange * 0.15;
    var yMin   = minW - wPad;
    var yMax   = maxW + wPad;

    function xPos(i) {
      return pad.left + (entries.length < 2 ? cw / 2 : (i / (entries.length - 1)) * cw);
    }
    function yPos(w) {
      return pad.top + ch - ((w - yMin) / (yMax - yMin)) * ch;
    }

    var ns = 'http://www.w3.org/2000/svg';

    // Gradient definition
    var defs = document.createElementNS(ns, 'defs');
    var grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'wg');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    var s1 = document.createElementNS(ns, 'stop');
    s1.setAttribute('offset', '0%');
    s1.setAttribute('stop-color', '#3b82f6');
    s1.setAttribute('stop-opacity', '0.25');
    var s2 = document.createElementNS(ns, 'stop');
    s2.setAttribute('offset', '100%');
    s2.setAttribute('stop-color', '#3b82f6');
    s2.setAttribute('stop-opacity', '0');
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Y-axis grid lines and labels
    var yTicks = 4;
    for (var t = 0; t <= yTicks; t++) {
      var wVal = yMin + (yMax - yMin) * (t / yTicks);
      var y    = yPos(wVal);
      var gridLine = document.createElementNS(ns, 'line');
      gridLine.setAttribute('x1', pad.left); gridLine.setAttribute('x2', W - pad.right);
      gridLine.setAttribute('y1', y);        gridLine.setAttribute('y2', y);
      gridLine.setAttribute('stroke', 'rgba(255,255,255,0.05)');
      gridLine.setAttribute('stroke-width', '1');
      svg.appendChild(gridLine);
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('x', pad.left - 4);
      label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '8');
      label.setAttribute('fill', '#475569');
      label.textContent = wVal.toFixed(1);
      svg.appendChild(label);
    }

    // X-axis date labels
    var maxXLabels = Math.min(entries.length, 5);
    var step = Math.max(1, Math.floor((entries.length - 1) / (maxXLabels - 1)));
    for (var i = 0; i < entries.length; i += step) {
      var d = new Date(entries[i].date + 'T00:00:00');
      var lbl = (d.getMonth() + 1) + '/' + d.getDate();
      var xLabel = document.createElementNS(ns, 'text');
      xLabel.setAttribute('x', xPos(i));
      xLabel.setAttribute('y', H - pad.bottom + 13);
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('font-size', '8');
      xLabel.setAttribute('fill', '#475569');
      xLabel.textContent = lbl;
      svg.appendChild(xLabel);
    }

    if (entries.length < 2) {
      // Single dot
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', xPos(0)); dot.setAttribute('cy', yPos(entries[0].weight_kg));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#3b82f6');
      svg.appendChild(dot);
      return;
    }

    // Build points array
    var pts = entries.map(function (e, i) {
      return { x: xPos(i), y: yPos(e.weight_kg) };
    });

    // Catmull-Rom smooth path
    function smoothPath(p) {
      var d = 'M ' + p[0].x + ' ' + p[0].y;
      for (var i = 0; i < p.length - 1; i++) {
        var p0 = p[Math.max(0, i - 1)];
        var p1 = p[i];
        var p2 = p[i + 1];
        var p3 = p[Math.min(p.length - 1, i + 2)];
        var cp1x = p1.x + (p2.x - p0.x) / 6;
        var cp1y = p1.y + (p2.y - p0.y) / 6;
        var cp2x = p2.x - (p3.x - p1.x) / 6;
        var cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ' C ' + cp1x + ' ' + cp1y + ' ' + cp2x + ' ' + cp2y + ' ' + p2.x + ' ' + p2.y;
      }
      return d;
    }

    var pathD = smoothPath(pts);
    var bottomY = pad.top + ch;

    // Fill area under curve
    var fill = document.createElementNS(ns, 'path');
    fill.setAttribute('d', pathD + ' L ' + pts[pts.length-1].x + ' ' + bottomY + ' L ' + pts[0].x + ' ' + bottomY + ' Z');
    fill.setAttribute('fill', 'url(#wg)');
    svg.appendChild(fill);

    // Curve line
    var line = document.createElementNS(ns, 'path');
    line.setAttribute('d', pathD);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#3b82f6');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('style', 'filter:drop-shadow(0 0 4px rgba(59,130,246,0.6))');
    svg.appendChild(line);

    // Data points
    pts.forEach(function (p, i) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
      c.setAttribute('r', entries.length > 30 ? '2' : '3');
      c.setAttribute('fill', '#3b82f6');
      c.setAttribute('stroke', '#060d1b');
      c.setAttribute('stroke-width', '1.5');
      svg.appendChild(c);
    });
  }

  loadChart(activeDays);
})();


// ── Custom foods (log page) ───────────────────────────────────────────────────
(function initCustomFoods() {
  var toggleBtn   = document.getElementById('toggle-my-foods');
  if (!toggleBtn) return;

  var panel       = document.getElementById('my-foods-panel');
  var chevron     = document.getElementById('my-foods-chevron');
  var countBadge  = document.getElementById('my-foods-count');
  var myFoodsList = document.getElementById('my-foods-list');

  // Modal elements
  var openModalBtn  = document.getElementById('open-cf-modal');
  var modalOverlay  = document.getElementById('cf-modal-overlay');
  var modalCloseBtn = document.getElementById('cf-modal-close');
  var saveBtn       = document.getElementById('save-custom-food-btn');
  var cfName        = document.getElementById('cf-name');
  var cfKcal        = document.getElementById('cf-kcal');
  var cfProtein     = document.getElementById('cf-protein');
  var cfCarbs       = document.getElementById('cf-carbs');
  var cfFat         = document.getElementById('cf-fat');
  var cfUnitLabel   = document.getElementById('cf-unit-label');

  var customFoods = [];
  var panelOpen   = false;

  // ── Modal open / close ──────────────────────────────────────
  function openModal() {
    modalOverlay.classList.remove('hidden');
    modalOverlay.classList.add('flex');
    cfName.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    modalOverlay.classList.remove('flex');
  }

  function clearModal() {
    cfName.value = ''; cfKcal.value = ''; cfProtein.value = '';
    cfCarbs.value = ''; cfFat.value = ''; cfUnitLabel.value = '';
  }

  if (openModalBtn)  openModalBtn.addEventListener('click', openModal);
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });
  }

  // ── Load & render list ──────────────────────────────────────
  async function loadCustomFoods() {
    try {
      var res  = await fetch('/api/custom-foods');
      var data = await res.json();
      customFoods = data.foods || [];
      renderMyFoodsList();
      if (countBadge) {
        countBadge.textContent = customFoods.length ? '(' + customFoods.length + ')' : '';
      }
    } catch (e) {}
  }

  function renderMyFoodsList() {
    if (!myFoodsList) return;
    myFoodsList.innerHTML = '';
    if (customFoods.length === 0) {
      myFoodsList.innerHTML =
        '<p class="text-slate-500 text-xs text-center py-4">No custom foods yet. Tap Add Custom Food to create one.</p>';
      return;
    }
    customFoods.forEach(function (food) {
      var unitLabel = food.unit_label && food.unit_label !== 'grams' ? food.unit_label : 'serving';
      var card = document.createElement('div');
      card.className = 'flex items-start justify-between gap-3 rounded-xl px-4 py-3';
      card.style.cssText = 'background:#0d1829; border:1px solid rgba(255,255,255,0.07)';
      card.innerHTML =
        '<button type="button" class="flex-1 text-left" data-cf-id="' + food.id + '">' +
          '<p class="font-medium text-slate-200 text-sm">' + escHtml(food.name) + '</p>' +
          '<div class="flex gap-3 mt-1 text-xs text-slate-500">' +
            '<span class="text-blue-400 font-semibold">' + food.calories_per_100g + ' kcal</span>' +
            '<span>P: ' + food.protein_per_100g + 'g</span>' +
            '<span>C: ' + food.carbs_per_100g + 'g</span>' +
            '<span>F: ' + food.fat_per_100g + 'g</span>' +
            '<span class="text-slate-600">per ' + escHtml(unitLabel) + '</span>' +
          '</div>' +
        '</button>' +
        '<button type="button" class="flex-shrink-0 p-1.5 text-slate-600 hover:text-rose-400 transition-colors rounded" ' +
                'data-delete-cf="' + food.id + '" aria-label="Delete">' +
          '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" ' +
               'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>' +
            '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>' +
          '</svg>' +
        '</button>';
      myFoodsList.appendChild(card);
    });

    // Tap a food to select it for logging
    myFoodsList.querySelectorAll('[data-cf-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var food = customFoods.find(function (f) { return f.id === parseInt(btn.dataset.cfId, 10); });
        if (food && window._selectFood) {
          window._selectFood({
            name:           food.name,
            kcal:           food.calories_per_100g,
            protein:        food.protein_per_100g,
            carbs:          food.carbs_per_100g,
            fat:            food.fat_per_100g,
            unit:           'unit',
            unit_label:     food.unit_label && food.unit_label !== 'grams' ? food.unit_label : 'serving',
            grams_per_unit: 100,
            custom:         true,
            custom_id:      food.id,
          });
          panel.classList.add('hidden');
          chevron.style.transform = '';
          panelOpen = false;
        }
      });
    });

    // Delete a food
    myFoodsList.querySelectorAll('[data-delete-cf]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = parseInt(btn.dataset.deleteCf, 10);
        if (!confirm('Delete this custom food?')) return;
        try {
          var res = await fetch('/api/custom-foods/' + id, { method: 'DELETE' });
          if (res.ok) {
            showToast('Custom food deleted.');
            await loadCustomFoods();
          }
        } catch (e) {
          showToast('❌ Could not delete.', true);
        }
      });
    });
  }

  // ── Toggle panel ────────────────────────────────────────────
  toggleBtn.addEventListener('click', function () {
    panelOpen = !panelOpen;
    panel.classList.toggle('hidden', !panelOpen);
    chevron.style.transform = panelOpen ? 'rotate(180deg)' : '';
  });

  // ── Save new custom food ────────────────────────────────────
  // Macros are stored as per-serving values (grams_per_unit=100 so 1 unit = 100 "virtual g")
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      var name    = cfName.value.trim();
      var kcal    = parseFloat(cfKcal.value);
      var protein = parseFloat(cfProtein.value);
      var carbs   = parseFloat(cfCarbs.value);
      var fat     = parseFloat(cfFat.value);

      if (!name)   { cfName.focus(); showToast('Enter a food name.', true); return; }
      if ([kcal, protein, carbs, fat].some(isNaN)) {
        showToast('Fill in all four macro fields.', true); return;
      }

      var unitLabel = cfUnitLabel.value.trim() || 'serving';

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';

      try {
        var res = await fetch('/api/custom-foods', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            calories_per_100g: kcal,
            protein_per_100g:  protein,
            carbs_per_100g:    carbs,
            fat_per_100g:      fat,
            unit:              'unit',
            unit_label:        unitLabel,
            grams_per_unit:    100,
          }),
        });
        if (res.ok) {
          showToast('✅ ' + name + ' saved!');
          clearModal();
          closeModal();
          await loadCustomFoods();
        } else {
          showToast('❌ Could not save.', true);
        }
      } catch (e) {
        showToast('❌ Network error.', true);
      } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Food';
      }
    });
  }

  loadCustomFoods();
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
