import { routeCloudCore } from "../src/cloud-core.js";

class ApiException extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

const user = {
  id: "test-user",
  email: "test@example.com",
  profile_json: JSON.stringify({
    age: 31,
    target_calories: 2200,
    meals_per_day: 2,
    allergies: ["peanut"],
  }),
};
const dependencies = {
  ApiException,
  currentActiveUser: async () => user,
  rateLimit: async () => {},
};

const calorieRequest = jsonRequest("/profile/calculate-calories", {
  sex: "male",
  age: 31,
  height_cm: 182,
  weight_kg: 82,
  activity_level: "moderate",
  goal: "weight_loss",
});
const calorieResponse = await routeCloudCore(
  calorieRequest,
  {},
  "/profile/calculate-calories",
  dependencies,
);
const calories = await calorieResponse.json();
assert(calories.formula === "mifflin_st_jeor", "Calorie formula is missing");
assert(calories.target_calories >= 1500, "Calorie safety floor failed");

const profileResponse = await routeCloudCore(
  new Request("https://api.test/profile"),
  {},
  "/profile",
  dependencies,
);
const profile = (await profileResponse.json()).profile;
assert(profile.age === 31, "Stored profile was not normalized");
assert(profile.allergies[0] === "peanut", "Stored allergies were lost");

const intentResponse = await routeCloudCore(
  jsonRequest("/meal-planner/intent/parse", { message: "Hello" }),
  {},
  "/meal-planner/intent/parse",
  dependencies,
);
const intent = await intentResponse.json();
assert(intent.intent === "unknown", "Non-planner message should not call OpenAI");

let capturedOpenAiRequest = null;
globalThis.fetch = async (_url, init) => {
  capturedOpenAiRequest = JSON.parse(init.body);
  const meal = (mealType, name, mealCalories) => ({
    meal_type: mealType,
    name,
    ingredients: ["chicken", "rice"],
    instructions: ["Cook until ready"],
    calories: mealCalories,
    protein: 35,
    fat: 12,
    carbs: 45,
    eaten_weight_g: 350,
    main_carb: "rice",
    main_proteins: ["chicken"],
    score: 0.9,
    tier: "normal",
  });
  return Response.json({
    output_text: JSON.stringify({
      days: [{
        day: 1,
        meals: [
          meal("breakfast", "Chicken porridge", 900),
          meal("dinner", "Chicken with rice", 1200),
        ],
      }],
      warnings: [],
    }),
  });
};

const statement = {
  bind() {
    return this;
  },
  async run() {
    return { success: true };
  },
};
const planResponse = await routeCloudCore(
  jsonRequest("/meal-planner/generate", {
    days: 1,
    meals_per_day: 2,
    target_calories: 2200,
  }),
  {
    OPENAI_API_KEY: "test-only",
    DB: { prepare: () => statement },
  },
  "/meal-planner/generate",
  dependencies,
);
const plan = await planResponse.json();
assert(plan.days.length === 1, "Plan day count is invalid");
assert(plan.days[0].meals.length === 2, "Plan meal count is invalid");
assert(plan.progress.meals_total === 2, "Plan progress is invalid");
assert(capturedOpenAiRequest.store === false, "OpenAI storage must stay disabled");
assert(
  capturedOpenAiRequest.text?.format?.type === "json_schema",
  "Structured output schema is missing",
);
assert(!capturedOpenAiRequest.metadata?.user_id, "User identifier leaked to OpenAI");

console.log("cloud core smoke check passed");

function jsonRequest(path, body) {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
