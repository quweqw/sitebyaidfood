const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const GOALS = new Set(["balanced", "weight_loss", "muscle_gain"]);
const MEAL_STATUSES = new Set(["planned", "cooked", "eaten", "skipped"]);

export async function routeCloudCore(request, env, path, deps) {
  const fail = (status, code, message, details = {}) => {
    throw new deps.ApiException(status, code, message, details);
  };
  const auth = () => deps.currentActiveUser(request, env);
  const limitAi = (scope) => deps.rateLimit(scope);

  if (path === "/profile" && request.method === "GET") {
    return getProfile(await auth());
  }
  if (path === "/profile" && ["PUT", "PATCH"].includes(request.method)) {
    return saveProfile(request, env, await auth(), request.method === "PATCH", fail);
  }
  if (path === "/profile/calculate-calories" && request.method === "POST") {
    await auth();
    return calculateCaloriesEndpoint(request, fail);
  }
  if (path === "/recognition/image" && request.method === "POST") {
    await limitAi("ai:vision");
    return recognizeImage(request, env, await auth(), fail);
  }
  if (path === "/meal-planner/intent/parse" && request.method === "POST") {
    await limitAi("ai:intent");
    return parseIntent(request, env, await auth(), fail);
  }
  if (path === "/meal-planner/generate" && request.method === "POST") {
    await limitAi("ai:planner");
    return generateMealPlanEndpoint(request, env, await auth(), fail);
  }
  if (path === "/meal-planner/dinner-suggestion" && request.method === "POST") {
    await limitAi("ai:suggestion");
    return dinnerSuggestionEndpoint(request, env, await auth(), fail);
  }
  if (path === "/meal-planner/latest" && request.method === "GET") {
    return latestMealPlan(env, await auth(), fail);
  }
  if (/^\/meal-planner\/[^/]+$/.test(path) && request.method === "GET") {
    return getMealPlan(env, await auth(), decodeURIComponent(path.split("/")[2]), fail);
  }
  if (/^\/meal-planner\/[^/]+\/meals\/[^/]+\/progress$/.test(path) && request.method === "PATCH") {
    const parts = path.split("/");
    return updateMealProgress(request, env, await auth(), decodeURIComponent(parts[2]), decodeURIComponent(parts[4]), fail);
  }
  if (/^\/meal-planner\/[^/]+\/meals\/[^/]+\/(replace|regenerate)$/.test(path) && request.method === "POST") {
    await limitAi("ai:meal-replacement");
    const parts = path.split("/");
    return replaceMeal(
      env,
      await auth(),
      decodeURIComponent(parts[2]),
      decodeURIComponent(parts[4]),
      parts[5] === "regenerate",
      fail,
    );
  }
  return null;
}

function getProfile(user) {
  return json({ profile: profileForUser(user) });
}

async function saveProfile(request, env, user, partial, fail) {
  const data = await readJson(request, fail);
  if (data.email != null && normalizeEmail(data.email) !== normalizeEmail(user.email)) {
    fail(400, "EMAIL_CHANGE_NOT_ALLOWED", "Email аккаунта нельзя изменить через профиль");
  }
  const current = profileForUser(user);
  const profile = normalizeProfile(data, partial ? current : defaultProfile(user.email), user.email);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(profile), now, user.id)
    .run();
  return json({ profile });
}

async function calculateCaloriesEndpoint(request, fail) {
  const data = await readJson(request, fail);
  return json(calculateCalories(data, fail));
}

async function recognizeImage(request, env, user, fail) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    fail(415, "UNSUPPORTED_MEDIA_TYPE", "Expected multipart/form-data");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    fail(400, "IMAGE_REQUIRED", "Выберите изображение блюда");
  }
  if (!IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    fail(400, "IMAGE_TYPE_NOT_ALLOWED", "Поддерживаются JPEG, PNG, WebP и GIF");
  }
  const maxBytes = intEnv(env, "OPENAI_IMAGE_MAX_BYTES", 6 * 1024 * 1024);
  if (Number(file.size || 0) > maxBytes) {
    fail(413, "IMAGE_TOO_LARGE", `Размер изображения не должен превышать ${Math.floor(maxBytes / 1024 / 1024)} МБ`);
  }

  const stored = profileForUser(user);
  const profile = normalizeProfile({
    age: form.get("age"),
    gender: form.get("gender"),
    height: form.get("height"),
    weight: form.get("weight"),
    diet_type: form.get("diet_type"),
    daily_calories: form.get("daily_calories"),
    allergens: splitList(form.get("allergens")),
    excluded_products: splitList(form.get("excluded_products")),
    favorite_products: splitList(form.get("favorite_products")),
    disliked_products: splitList(form.get("disliked_products")),
  }, stored, user.email);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageUrl = `data:${file.type};base64,${bytesToBase64(bytes)}`;
  const result = await openAiStructured(env, {
    model: stringEnv(env, "OPENAI_VISION_MODEL", stringEnv(env, "OPENAI_MODEL", "gpt-5.4-mini")),
    maxOutputTokens: intEnv(env, "OPENAI_VISION_MAX_OUTPUT_TOKENS", 2200),
    name: "food_image_analysis",
    schema: recognitionSchema(),
    instructions: [
      "Ты модуль AI Food для анализа фотографии еды.",
      "Определи блюдо и только видимые или очень вероятные ингредиенты.",
      "КБЖУ укажи как осторожную оценку на 100 граммов.",
      "Не утверждай точный состав, если его нельзя установить по фото.",
      "Все названия, шаги и советы пиши по-русски.",
      safetyInstructions(profile),
    ].join("\n"),
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: `Профиль пользователя: ${JSON.stringify(profile)}. Проанализируй фотографию.` },
        { type: "input_image", image_url: imageUrl, detail: "high" },
      ],
    }],
    fail,
  });
  const detectedRestrictions = matchingRestrictions(
    [result.meal, ...(result.ingredients || [])],
    profile,
  );
  if (detectedRestrictions.length) {
    const warning = `Возможны ограничения профиля: ${detectedRestrictions.join(", ")}. Не употребляйте блюдо без проверки состава.`;
    result.warnings = [...new Set([...(result.warnings || []), warning])];
    result.recipe.tips = [result.recipe.tips, warning].filter(Boolean).join(" ");
  }

  return json({
    ...result,
    score: clampNumber(result.confidence, 0, 1, 0),
    nutrition_basis: "per_100g_estimate",
    recipe_steps: result.recipe?.instructions || [],
    tips: result.recipe?.tips || "",
  });
}

async function parseIntent(request, env, user, fail) {
  const data = await readJson(request, fail);
  const message = requiredText(data.message, 2000, "message", fail);
  const profile = normalizeProfile(data.current_profile || {}, profileForUser(user), user.email);
  if (!looksLikeMealPlannerIntent(message)) {
    return json({
      intent: "unknown",
      confidence: 1,
      extracted_parameters: {
        days: 7,
        meals_per_day: profile.meals_per_day,
        goal: profile.goal,
        target_calories: profile.target_calories,
        servings: 1,
        people_count: 1,
        meal_type: "dinner",
        ingredients_available: [],
        allergies: profile.allergies,
        excluded: profile.excluded_ingredients,
        preferred: profile.preferred_ingredients,
        disliked: profile.disliked_ingredients,
      },
      requires_confirmation: false,
      confirmation_message: "",
      actions: [],
    });
  }
  const result = await openAiStructured(env, {
    model: stringEnv(env, "OPENAI_MODEL", "gpt-5.4-mini"),
    maxOutputTokens: 900,
    name: "meal_planner_intent",
    schema: intentSchema(),
    instructions: [
      "Определи, просит ли пользователь составить рацион или предложить отдельный ужин.",
      "Если запрос меняет калории, цель, число дней, приемов пищи или ограничения, запроси подтверждение.",
      "Если это обычный вопрос о питании, верни intent unknown.",
      "Параметры, которых нет в сообщении, заполни безопасными значениями из текущего профиля.",
      "Ответные сообщения пиши по-русски.",
    ].join("\n"),
    input: `Текущий профиль: ${JSON.stringify(profile)}\nСообщение: ${message}`,
    fail,
  });
  return json({
    intent: result.intent,
    confidence: clampNumber(result.confidence, 0, 1, 0),
    extracted_parameters: result.extracted_parameters,
    requires_confirmation: Boolean(result.requires_confirmation),
    confirmation_message: result.confirmation_message,
    actions: result.actions,
  });
}

async function generateMealPlanEndpoint(request, env, user, fail) {
  const data = await readJson(request, fail);
  const profile = profileForUser(user);
  const normalized = normalizePlanRequest(data, profile);
  if (data.save_to_profile === true) {
    const updatedProfile = applyPlanRequestToProfile(profile, normalized);
    await saveProfileJson(env, user.id, updatedProfile);
  }
  const plan = await generatePlan(env, normalized, fail);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO meal_plans (id, user_id, request_json, response_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(plan.plan_id, user.id, JSON.stringify(normalized), JSON.stringify(plan), now, now).run();
  return json(plan);
}

async function dinnerSuggestionEndpoint(request, env, user, fail) {
  const data = await readJson(request, fail);
  const profile = profileForUser(user);
  const requestProfile = applyOverrides(profile, data.temporary_overrides || {});
  const target = clampInt(data.target_calories, 200, 1500, Math.round(requestProfile.target_calories / requestProfile.meals_per_day));
  const mealType = mealTypeValue(data.meal_type || "dinner");
  const suggestions = await generateMeals(env, {
    days: 1,
    mealsPerDay: 3,
    targetCalories: target,
    servings: clampInt(data.servings, 1, 12, 1),
    peopleCount: clampInt(data.people_count, 1, 12, 1),
    profile: requestProfile,
    exactMeals: 3,
    mealType,
    ingredientsAvailable: cleanList(data.ingredients_available, 30, 80),
  }, fail);
  return json({
    suggestions: suggestions.days[0].meals.map((meal, index) => normalizeMeal(meal, 1, index + 1, {
      servings: clampInt(data.servings, 1, 12, 1),
      people_count: clampInt(data.people_count, 1, 12, 1),
      portion_mode: "single_user",
    })),
  });
}

async function latestMealPlan(env, user, fail) {
  const row = await env.DB.prepare(`
    SELECT response_json FROM meal_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).bind(user.id).first();
  if (!row) fail(404, "PLAN_NOT_FOUND", "Рацион пока не создан");
  return json(parseStoredPlan(row.response_json, fail));
}

async function getMealPlan(env, user, planId, fail) {
  const row = await planRow(env, user.id, planId);
  if (!row) fail(404, "PLAN_NOT_FOUND", "Рацион не найден");
  return json(parseStoredPlan(row.response_json, fail));
}

async function updateMealProgress(request, env, user, planId, mealId, fail) {
  const data = await readJson(request, fail);
  const row = await planRow(env, user.id, planId);
  if (!row) fail(404, "PLAN_NOT_FOUND", "Рацион не найден");
  const plan = parseStoredPlan(row.response_json, fail);
  const meal = findMeal(plan, mealId);
  if (!meal) fail(404, "MEAL_NOT_FOUND", "Блюдо не найдено в рационе");

  if (data.status != null) {
    const status = String(data.status);
    if (!MEAL_STATUSES.has(status)) fail(400, "INVALID_MEAL_STATUS", "Неизвестный статус блюда");
    meal.progress.status = status;
  }
  if (data.checked != null) meal.progress.checked = Boolean(data.checked);
  if (data.user_note != null) meal.progress.user_note = String(data.user_note).slice(0, 500);
  if (data.completed_at != null) meal.progress.completed_at = String(data.completed_at).slice(0, 80);
  else if (meal.progress.checked || ["eaten", "skipped"].includes(meal.progress.status)) {
    meal.progress.completed_at = new Date().toISOString();
  } else {
    meal.progress.completed_at = null;
  }
  plan.progress = buildProgress(plan);
  await updateStoredPlan(env, planId, plan);
  return json({
    plan_id: planId,
    meal_id: mealId,
    meal_progress: meal.progress,
    plan_progress: plan.progress,
    updated_at: new Date().toISOString(),
  });
}

async function replaceMeal(env, user, planId, mealId, allowSame, fail) {
  const row = await planRow(env, user.id, planId);
  if (!row) fail(404, "PLAN_NOT_FOUND", "Рацион не найден");
  const plan = parseStoredPlan(row.response_json, fail);
  const requestData = safeJson(row.request_json, {});
  let location = null;
  for (const day of plan.days) {
    const index = day.meals.findIndex((meal) => meal.meal_id === mealId);
    if (index >= 0) {
      location = { day, index, meal: day.meals[index] };
      break;
    }
  }
  if (!location) fail(404, "MEAL_NOT_FOUND", "Блюдо не найдено в рационе");

  const target = Math.round(location.meal.nutrition_for_user?.calories || requestData.target_calories / requestData.meals_per_day || 600);
  const generated = await generateMeals(env, {
    days: 1,
    mealsPerDay: 3,
    targetCalories: target,
    servings: location.meal.servings_total || 1,
    peopleCount: location.meal.people_count || 1,
    profile: requestData.profile || profileForUser(user),
    exactMeals: 3,
    mealType: mealTypeValue(location.meal.meal_type),
    ingredientsAvailable: [],
  }, fail);
  const candidates = generated.days[0].meals;
  const rawReplacement = candidates.find((item) => item.name !== location.meal.name) || (allowSame ? candidates[0] : null);
  if (!rawReplacement) fail(404, "NO_SAFE_CANDIDATES", "Не удалось подобрать безопасную замену");
  const replacement = normalizeMeal(rawReplacement, location.day.day, location.meal.slot, {
    servings: location.meal.servings_total || 1,
    people_count: location.meal.people_count || 1,
    portion_mode: requestData.portion_mode || "single_user",
  });
  replacement.meal_id = location.meal.meal_id;
  location.day.meals[location.index] = replacement;
  recalculateDay(location.day);
  plan.summary = buildSummary(plan.days, requestData);
  plan.progress = buildProgress(plan);
  await updateStoredPlan(env, planId, plan);
  return json(plan);
}

async function generatePlan(env, requestData, fail) {
  const raw = await generateMeals(env, {
    days: requestData.days,
    mealsPerDay: requestData.meals_per_day,
    targetCalories: requestData.target_calories,
    servings: requestData.servings,
    peopleCount: requestData.people_count,
    profile: requestData.profile,
    exactMeals: requestData.meals_per_day,
    mealType: "",
    ingredientsAvailable: [],
  }, fail);
  const planId = crypto.randomUUID();
  const days = raw.days.map((day, dayIndex) => {
    const meals = day.meals.map((meal, mealIndex) => normalizeMeal(meal, dayIndex + 1, mealIndex + 1, requestData));
    const result = {
      day: dayIndex + 1,
      score: average(meals.map((meal) => meal.score)),
      target_calories: requestData.target_calories,
      actual_calories: 0,
      macro_summary: emptyNutrition(),
      meals,
    };
    recalculateDay(result);
    return result;
  });
  const plan = {
    plan_id: planId,
    days,
    summary: buildSummary(days, requestData),
    progress: {},
    warnings: cleanList(raw.warnings, 20, 300),
  };
  plan.progress = buildProgress(plan);
  return plan;
}

async function generateMeals(env, params, fail) {
  const schema = generatedMealsSchema(params.days, params.exactMeals);
  const preferredMealType = params.mealType ? `Все варианты должны относиться к типу ${params.mealType}.` : "";
  const available = params.ingredientsAvailable.length
    ? `По возможности используй доступные ингредиенты: ${params.ingredientsAvailable.join(", ")}.`
    : "";
  const result = await openAiStructured(env, {
    model: stringEnv(env, "OPENAI_PLANNER_MODEL", stringEnv(env, "OPENAI_MODEL", "gpt-5.4-mini")),
    maxOutputTokens: intEnv(env, "OPENAI_PLANNER_MAX_OUTPUT_TOKENS", 12000),
    name: "ai_food_meal_plan",
    schema,
    instructions: [
      "Ты генератор безопасного персонального рациона AI Food.",
      `Создай ровно ${params.days} дней и ровно ${params.exactMeals} блюд в каждом дне.`,
      `Цель калорий для каждого дня: ${params.targetCalories} ккал.`,
      "Распредели белки, жиры и углеводы разумно. КБЖУ указывай на пользовательскую порцию.",
      "Названия, ингредиенты и инструкции пиши по-русски.",
      "Не повторяй одно блюдо в пределах плана. Используй обычные доступные продукты.",
      "Не добавляй продукты из аллергенов или исключений ни под другим названием, ни как необязательный ингредиент.",
      preferredMealType,
      available,
      safetyInstructions(params.profile),
    ].filter(Boolean).join("\n"),
    input: JSON.stringify({
      profile: params.profile,
      servings: params.servings,
      people_count: params.peopleCount,
      requested_meal_type: params.mealType || null,
      ingredients_available: params.ingredientsAvailable,
    }),
    fail,
  });
  const unsafeTerms = unsafeGeneratedTerms(result, params.profile);
  if (unsafeTerms.length) {
    console.error("Unsafe meal plan rejected", JSON.stringify(unsafeTerms));
    fail(422, "UNSAFE_MEAL_PLAN", "Не удалось составить рацион без запрещенных продуктов. Уточните ограничения и повторите запрос.", {
      restricted_terms: unsafeTerms,
    });
  }
  return result;
}

async function openAiStructured(env, options) {
  const apiKey = stringEnv(env, "OPENAI_API_KEY", "");
  if (!apiKey) options.fail(503, "OPENAI_NOT_CONFIGURED", "OpenAI API не настроен");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      instructions: options.instructions,
      input: options.input,
      max_output_tokens: options.maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: options.name,
          strict: true,
          schema: options.schema,
        },
      },
      metadata: { app: "ai-food" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("OpenAI structured request failed", response.status, JSON.stringify(body).slice(0, 1200));
    options.fail(502, "OPENAI_REQUEST_FAILED", "OpenAI не смог обработать запрос");
  }
  const text = extractOutputText(body);
  if (!text) options.fail(502, "OPENAI_EMPTY_RESPONSE", "OpenAI вернул пустой ответ");
  try {
    return JSON.parse(text);
  } catch {
    console.error("OpenAI JSON parse failed", text.slice(0, 1000));
    options.fail(502, "OPENAI_INVALID_RESPONSE", "OpenAI вернул некорректную структуру данных");
  }
}

function normalizePlanRequest(data, storedProfile) {
  const profile = applyOverrides(storedProfile, data.temporary_overrides || {});
  const targetCalories = clampInt(
    data.target_calories ?? data.temporary_overrides?.target_calories,
    900,
    5000,
    profile.target_calories,
  );
  const mealsPerDay = clampInt(
    data.meals_per_day ?? data.temporary_overrides?.meals_per_day,
    1,
    6,
    profile.meals_per_day,
  );
  const goal = normalizeGoal(data.goal ?? data.temporary_overrides?.goal ?? profile.goal);
  return {
    days: clampInt(data.days, 1, 7, 7),
    meals_per_day: mealsPerDay,
    goal,
    target_calories: targetCalories,
    servings: clampInt(data.servings, 1, 12, 1),
    people_count: clampInt(data.people_count, 1, 12, 1),
    portion_mode: data.portion_mode === "cook_for_people" ? "cook_for_people" : "single_user",
    profile: {
      ...profile,
      goal,
      diet_type: dietTypeFromGoal(goal),
      target_calories: targetCalories,
      daily_calories: targetCalories,
      meals_per_day: mealsPerDay,
    },
  };
}

function normalizeMeal(raw, day, slot, requestData) {
  const servings = clampInt(requestData.servings, 1, 12, 1);
  const peopleCount = clampInt(requestData.people_count, 1, 12, 1);
  const nutrition = normalizeNutrition(raw);
  const total = scaleNutrition(nutrition, servings);
  const ingredients = cleanList(raw.ingredients, 30, 160);
  const instructions = cleanList(raw.instructions, 20, 500);
  const name = String(raw.name || "Блюдо").slice(0, 160);
  return {
    meal_id: `d${day}-s${slot}-${crypto.randomUUID().slice(0, 8)}`,
    slot,
    meal_type: mealTypeValue(raw.meal_type),
    name,
    score: clampNumber(raw.score, 0, 1, 0.8),
    tier: ["normal", "relaxed", "emergency"].includes(raw.tier) ? raw.tier : "normal",
    servings,
    servings_total: servings,
    people_count: peopleCount,
    eaten_weight_g: clampNumber(raw.eaten_weight_g, 0, 3000, 0),
    cooking_total_weight_g: clampNumber(raw.eaten_weight_g, 0, 3000, 0) * servings,
    user_eaten_weight_g: clampNumber(raw.eaten_weight_g, 0, 3000, 0),
    nutrition,
    nutrition_total: total,
    nutrition_per_serving: nutrition,
    nutrition_for_user: nutrition,
    main_carb: String(raw.main_carb || "").slice(0, 100) || null,
    main_proteins: cleanList(raw.main_proteins, 10, 100),
    recipe: {
      id: slug(name),
      name,
      image_url: null,
      ingredients,
      ingredients_detail: ingredients,
      instructions,
      serving_model: {
        servings_total: servings,
        people_count: peopleCount,
        portion_mode: requestData.portion_mode || "single_user",
      },
      scaling: {
        base_servings: 1,
        scale_factor: servings,
        scaled_ingredients: ingredients,
      },
    },
    progress: {
      status: "planned",
      checked: false,
      completed_at: null,
      user_note: "",
    },
  };
}

function buildSummary(days, requestData) {
  const meals = days.flatMap((day) => day.meals || []);
  const expected = clampInt(requestData.days, 1, 7, days.length) * clampInt(requestData.meals_per_day, 1, 6, 3);
  return {
    generated_meals: meals.length,
    empty_slots: Math.max(0, expected - meals.length),
    normal: meals.filter((meal) => meal.tier === "normal").length,
    relaxed: meals.filter((meal) => meal.tier === "relaxed").length,
    emergency: meals.filter((meal) => meal.tier === "emergency").length,
    avg_calorie_error: average(days.map((day) => relativeError(day.actual_calories, day.target_calories))),
    avg_protein_error: 0,
    avg_fat_error: 0,
    avg_carbs_error: 0,
  };
}

function buildProgress(plan) {
  const days = plan.days || [];
  const meals = days.flatMap((day) => day.meals || []);
  const complete = meals.filter((meal) => meal.progress?.checked || ["eaten", "skipped"].includes(meal.progress?.status));
  const completeIds = new Set(complete.map((meal) => meal.meal_id));
  const daysCompleted = days.filter((day) => day.meals?.length && day.meals.every((meal) => completeIds.has(meal.meal_id))).length;
  return {
    plan_id: plan.plan_id,
    days_total: days.length,
    days_completed: daysCompleted,
    meals_total: meals.length,
    meals_completed: complete.length,
    completion_percent: meals.length ? Math.round((complete.length / meals.length) * 1000) / 10 : 0,
    current_day: days.length ? Math.min(days.length, daysCompleted + 1) : 1,
  };
}

function recalculateDay(day) {
  const total = day.meals.reduce((sum, meal) => addNutrition(sum, meal.nutrition_for_user || meal.nutrition), emptyNutrition());
  day.macro_summary = total;
  day.actual_calories = total.calories;
  day.score = average(day.meals.map((meal) => meal.score));
}

function profileForUser(user) {
  return normalizeProfile(safeJson(user.profile_json, {}), defaultProfile(user.email), user.email);
}

function defaultProfile(email = "") {
  return {
    email,
    name: "",
    sex: "male",
    gender: "male",
    age: 25,
    height_cm: 175,
    height: 175,
    weight_kg: 70,
    weight: 70,
    activity_level: "moderate",
    goal: "balanced",
    diet_type: "normal",
    target_calories: 2000,
    daily_calories: 2000,
    meals_per_day: 3,
    allergies: [],
    allergens: [],
    preferred_ingredients: [],
    favorite_products: [],
    disliked_ingredients: [],
    disliked_products: [],
    excluded_ingredients: [],
    excluded_products: [],
    push_notifications: true,
  };
}

function normalizeProfile(data, base, email) {
  const source = data || {};
  const sex = ["male", "female", "other"].includes(String(source.sex ?? source.gender ?? base.sex))
    ? String(source.sex ?? source.gender ?? base.sex)
    : "male";
  const goal = normalizeGoal(source.goal ?? source.diet_type ?? base.goal);
  const allergies = source.allergies != null || source.allergens != null
    ? cleanList(source.allergies ?? source.allergens, 50, 100)
    : base.allergies;
  const preferred = source.preferred_ingredients != null || source.favorite_products != null || source.preferred != null
    ? cleanList(source.preferred_ingredients ?? source.favorite_products ?? source.preferred, 50, 100)
    : base.preferred_ingredients;
  const disliked = source.disliked_ingredients != null || source.disliked_products != null || source.disliked != null
    ? cleanList(source.disliked_ingredients ?? source.disliked_products ?? source.disliked, 50, 100)
    : base.disliked_ingredients;
  const excluded = source.excluded_ingredients != null || source.excluded_products != null || source.excluded != null
    ? cleanList(source.excluded_ingredients ?? source.excluded_products ?? source.excluded, 50, 100)
    : base.excluded_ingredients;
  const target = clampInt(source.target_calories ?? source.daily_calories, 900, 5000, base.target_calories);
  const height = clampInt(source.height_cm ?? source.height, 80, 250, base.height_cm);
  const weight = clampNumber(source.weight_kg ?? source.weight, 25, 350, base.weight_kg);
  const activity = Object.hasOwn(ACTIVITY_MULTIPLIERS, String(source.activity_level ?? base.activity_level))
    ? String(source.activity_level ?? base.activity_level)
    : "moderate";
  return {
    email,
    name: String(source.name ?? base.name ?? "").trim().slice(0, 120),
    sex,
    gender: sex,
    age: clampInt(source.age, 10, 100, base.age),
    height_cm: height,
    height,
    weight_kg: weight,
    weight,
    activity_level: activity,
    goal,
    diet_type: dietTypeFromGoal(goal),
    target_calories: target,
    daily_calories: target,
    meals_per_day: clampInt(source.meals_per_day, 1, 6, base.meals_per_day),
    allergies,
    allergens: allergies,
    preferred_ingredients: preferred,
    favorite_products: preferred,
    disliked_ingredients: disliked,
    disliked_products: disliked,
    excluded_ingredients: excluded,
    excluded_products: excluded,
    push_notifications: source.push_notifications == null ? Boolean(base.push_notifications) : Boolean(source.push_notifications),
  };
}

function applyOverrides(profile, overrides) {
  return normalizeProfile({
    target_calories: overrides.target_calories,
    goal: overrides.goal,
    meals_per_day: overrides.meals_per_day,
    allergies: overrides.allergies ?? overrides.allergens,
    preferred_ingredients: overrides.preferred ?? overrides.preferred_ingredients,
    disliked_ingredients: overrides.disliked ?? overrides.disliked_ingredients,
    excluded_ingredients: overrides.excluded ?? overrides.excluded_ingredients,
  }, profile, profile.email);
}

function applyPlanRequestToProfile(profile, requestData) {
  return normalizeProfile({
    target_calories: requestData.target_calories,
    goal: requestData.goal,
    meals_per_day: requestData.meals_per_day,
    allergies: requestData.profile.allergies,
    preferred_ingredients: requestData.profile.preferred_ingredients,
    disliked_ingredients: requestData.profile.disliked_ingredients,
    excluded_ingredients: requestData.profile.excluded_ingredients,
  }, profile, profile.email);
}

function calculateCalories(data, fail) {
  const sex = ["male", "female", "other"].includes(String(data.sex)) ? String(data.sex) : "male";
  const age = clampInt(data.age, 10, 100, 25);
  const height = clampInt(data.height_cm ?? data.height, 80, 250, 175);
  const weight = clampNumber(data.weight_kg ?? data.weight, 25, 350, 70);
  const activity = String(data.activity_level || "moderate");
  if (!Object.hasOwn(ACTIVITY_MULTIPLIERS, activity)) fail(400, "INVALID_ACTIVITY_LEVEL", "Неизвестный уровень активности");
  const goal = normalizeGoal(data.goal);
  const bmrRaw = sex === "female"
    ? 10 * weight + 6.25 * height - 5 * age - 161
    : 10 * weight + 6.25 * height - 5 * age + 5;
  const bmr = Math.round(bmrRaw);
  const tdee = Math.round(bmrRaw * ACTIVITY_MULTIPLIERS[activity]);
  const adjustment = goal === "weight_loss" ? -450 : goal === "muscle_gain" ? 300 : 0;
  const minimum = sex === "female" ? 1200 : 1500;
  const target = Math.max(minimum, Math.min(5000, tdee + adjustment));
  const explanation = goal === "weight_loss"
    ? `Для снижения веса применен дефицит ${Math.abs(adjustment)} ккал.`
    : goal === "muscle_gain"
      ? `Для набора массы применен профицит ${adjustment} ккал.`
      : "Для поддержания веса калорийность оставлена на уровне TDEE.";
  return {
    bmr,
    tdee,
    target_calories: target,
    daily_calories: target,
    formula: "mifflin_st_jeor",
    goal_adjustment: adjustment,
    explanation,
  };
}

function safetyInstructions(profile) {
  return [
    `Аллергены: ${profile.allergies.join(", ") || "нет"}.`,
    `Полностью исключенные продукты: ${profile.excluded_ingredients.join(", ") || "нет"}.`,
    `Нежелательные продукты: ${profile.disliked_ingredients.join(", ") || "нет"}.`,
    `Предпочтения: ${profile.preferred_ingredients.join(", ") || "нет"}.`,
    `Цель: ${profile.goal}; дневная калорийность: ${profile.target_calories}; приемов пищи: ${profile.meals_per_day}.`,
  ].join("\n");
}

function looksLikeMealPlannerIntent(message) {
  const text = String(message || "").toLowerCase();
  return [
    "рацион",
    "план питания",
    "меню",
    "на неделю",
    "на день",
    "завтрак",
    "обед",
    "ужин",
    "перекус",
    "приемов пищи",
    "приёмов пищи",
    "калорий",
    "ккал",
  ].some((marker) => text.includes(marker));
}

function unsafeGeneratedTerms(result, profile) {
  return matchingRestrictions((result.days || [])
    .flatMap((day) => day.meals || [])
    .flatMap((meal) => [meal.name, ...(meal.ingredients || [])]), profile);
}

function matchingRestrictions(values, profile) {
  const restrictions = cleanList([
    ...(profile.allergies || []),
    ...(profile.excluded_ingredients || []),
  ], 100, 100)
    .map(normalizedFoodText)
    .filter((value) => value.length >= 3);
  if (!restrictions.length) return [];
  const generatedText = values.map(normalizedFoodText).join(" ");
  return restrictions.filter((term) => generatedText.includes(term));
}

function normalizedFoodText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function recognitionSchema() {
  return strictObject({
    meal: { type: "string" },
    confidence: { type: "number" },
    ingredients: stringArray(),
    nutrition: nutritionSchema(),
    recipe: strictObject({
      dish_name: { type: "string" },
      ingredients: stringArray(),
      instructions: stringArray(),
      tips: { type: "string" },
    }),
    substitutions: {
      type: "array",
      items: strictObject({
        from: { type: "string" },
        to: { type: "string" },
        reason: { type: "string" },
      }),
    },
    warnings: stringArray(),
  });
}

function intentSchema() {
  return strictObject({
    intent: { type: "string", enum: ["generate_meal_plan", "suggest_dinner", "unknown"] },
    confidence: { type: "number" },
    extracted_parameters: strictObject({
      days: { type: "integer" },
      meals_per_day: { type: "integer" },
      goal: { type: "string", enum: ["balanced", "weight_loss", "muscle_gain"] },
      target_calories: { type: "integer" },
      servings: { type: "integer" },
      people_count: { type: "integer" },
      meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      ingredients_available: stringArray(),
      allergies: stringArray(),
      excluded: stringArray(),
      preferred: stringArray(),
      disliked: stringArray(),
    }),
    requires_confirmation: { type: "boolean" },
    confirmation_message: { type: "string" },
    actions: {
      type: "array",
      items: { type: "string", enum: ["apply_once", "save_to_profile", "reject"] },
    },
  });
}

function generatedMealsSchema(days, mealsPerDay) {
  return strictObject({
    days: {
      type: "array",
      minItems: days,
      maxItems: days,
      items: strictObject({
        day: { type: "integer" },
        meals: {
          type: "array",
          minItems: mealsPerDay,
          maxItems: mealsPerDay,
          items: strictObject({
            meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
            name: { type: "string" },
            ingredients: stringArray(),
            instructions: stringArray(),
            calories: { type: "number" },
            protein: { type: "number" },
            fat: { type: "number" },
            carbs: { type: "number" },
            eaten_weight_g: { type: "number" },
            main_carb: { type: "string" },
            main_proteins: stringArray(),
            score: { type: "number" },
            tier: { type: "string", enum: ["normal", "relaxed", "emergency"] },
          }),
        },
      }),
    },
    warnings: stringArray(),
  });
}

function strictObject(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function stringArray() {
  return { type: "array", items: { type: "string" } };
}

function nutritionSchema() {
  return strictObject({
    calories: { type: "number" },
    protein: { type: "number" },
    fat: { type: "number" },
    carbs: { type: "number" },
  });
}

function normalizeNutrition(raw) {
  return {
    calories: round1(raw.calories),
    protein: round1(raw.protein),
    fat: round1(raw.fat),
    carbs: round1(raw.carbs),
  };
}

function emptyNutrition() {
  return { calories: 0, protein: 0, fat: 0, carbs: 0 };
}

function addNutrition(left, right = {}) {
  return {
    calories: round1(left.calories + Number(right.calories || 0)),
    protein: round1(left.protein + Number(right.protein || 0)),
    fat: round1(left.fat + Number(right.fat || 0)),
    carbs: round1(left.carbs + Number(right.carbs || 0)),
  };
}

function scaleNutrition(value, factor) {
  return {
    calories: round1(value.calories * factor),
    protein: round1(value.protein * factor),
    fat: round1(value.fat * factor),
    carbs: round1(value.carbs * factor),
  };
}

async function planRow(env, userId, planId) {
  return env.DB.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ?").bind(planId, userId).first();
}

async function updateStoredPlan(env, planId, plan) {
  await env.DB.prepare("UPDATE meal_plans SET response_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(plan), new Date().toISOString(), planId)
    .run();
}

async function saveProfileJson(env, userId, profile) {
  await env.DB.prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(profile), new Date().toISOString(), userId)
    .run();
}

function parseStoredPlan(value, fail) {
  try {
    return JSON.parse(value);
  } catch {
    fail(500, "PLAN_DATA_INVALID", "Сохраненный рацион поврежден");
  }
}

function findMeal(plan, mealId) {
  for (const day of plan.days || []) {
    const meal = (day.meals || []).find((item) => item.meal_id === mealId);
    if (meal) return meal;
  }
  return null;
}

function extractOutputText(body) {
  if (typeof body.output_text === "string") return body.output_text.trim();
  return (body.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

async function readJson(request, fail) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    fail(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  try {
    return await request.json();
  } catch {
    fail(400, "INVALID_JSON", "Invalid JSON body");
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(value, fallback) {
  try {
    return typeof value === "string" ? JSON.parse(value || "{}") : value || fallback;
  } catch {
    return fallback;
  }
}

function cleanList(value, maxItems = 50, maxLength = 120) {
  const source = Array.isArray(value) ? value : splitList(value);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))]
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function requiredText(value, maxLength, field, fail) {
  const text = String(value || "").trim();
  if (!text) fail(400, "VALIDATION_ERROR", `${field} is required`, { field });
  if (text.length > maxLength) fail(400, "VALIDATION_ERROR", `${field} is too long`, { field, max_length: maxLength });
  return text;
}

function normalizeGoal(value) {
  const raw = String(value || "balanced").toLowerCase();
  if (["cut", "weight_loss", "сушка", "похудение"].includes(raw)) return "weight_loss";
  if (["bulk", "muscle_gain", "массонабор", "набор"].includes(raw)) return "muscle_gain";
  return GOALS.has(raw) ? raw : "balanced";
}

function dietTypeFromGoal(goal) {
  if (goal === "weight_loss") return "cut";
  if (goal === "muscle_gain") return "bulk";
  return "normal";
}

function mealTypeValue(value) {
  const raw = String(value || "dinner").toLowerCase();
  const map = {
    "завтрак": "breakfast",
    "обед": "lunch",
    "ужин": "dinner",
    "перекус": "snack",
  };
  const normalized = map[raw] || raw;
  return ["breakfast", "lunch", "dinner", "snack"].includes(normalized) ? normalized : "dinner";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.round((finite.reduce((sum, item) => sum + item, 0) / finite.length) * 10000) / 10000 : 0;
}

function relativeError(actual, target) {
  const denominator = Number(target || 0);
  return denominator > 0 ? Math.abs(Number(actual || 0) - denominator) / denominator : 0;
}

function slug(value) {
  return String(value || "meal").toLowerCase().trim().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || crypto.randomUUID();
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function stringEnv(env, key, fallback = "") {
  const value = env[key];
  return value == null ? fallback : String(value);
}

function intEnv(env, key, fallback) {
  const value = Number.parseInt(env[key], 10);
  return Number.isFinite(value) ? value : fallback;
}
