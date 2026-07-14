# UGC Script Emotion And First-Frame Framework

Date: 2026-07-02

## Context

This note extends the UGC selfie realism work in
`docs/research/ugc-selfie-realism-prompt-recipes-2026-07-02.md`.

The key product decision: emotion should be structured before script writing. The script
agent should choose the emotional arc, UGC format, intensity ceiling, and first-frame
visual state before final dialogue is drafted. Image generation should receive those
choices as schema, not as loose prompt garnish.

Mendora / heartbreak is only one example. The same system must generalize to every app
category: fitness, finance, productivity, photo/video, education, games, utilities,
wellness, dating, shopping, creator tools, and local services.

## Core Principle

The first frame is the emotional first beat of the script.

For UGC selfie ads, the starting image needs to answer:

- What happened just before the creator hit record?
- What emotion is visible before the first word?
- What level of distress is ad-usable and policy-safe?
- What proof or app action will shift the creator from pain to agency?

The emotion does not always mean sadness. For many apps the best emotion is curiosity,
embarrassment, competitive pride, relief, surprise, skepticism, annoyance, or delight.

## Category-Agnostic Decision Inputs

The Script Agent should select emotion from the app context, not from a generic "make it
dramatic" instruction.

| Input | Purpose | Examples |
| --- | --- | --- |
| `appCategory` | broad creative lane | `fitness`, `finance`, `photo_video`, `education`, `utility`, `game`, `wellness`, `dating`, `productivity` |
| `userJob` | what the viewer is trying to do | track workouts, stop overspending, edit photos, study faster, identify a plant, process a breakup |
| `audienceTension` | life before the app | guessing, shame, confusion, boredom, wasted time, uncertainty, friction |
| `desiredShift` | emotional movement the ad should create | shame -> challenge, anxiety -> control, confusion -> clarity, boredom -> status, frustration -> relief |
| `proofType` | what the real app can show | score/rank, dashboard, before-after, generated output, checklist, journal, scan result, streak, saved time |
| `riskTier` | policy/brand-safety ceiling | `normal`, `financial_sensitive`, `body_image_sensitive`, `mental_health_adjacent`, `medical_or_safety_sensitive` |
| `ugcFormat` | creator situation | parked car, bedroom confession, walking voice note, desk review, gym mirror, couch reaction, kitchen demo |

The product should derive these from the URL import, App Memory proof, claims, audience,
and creative pack goal.

## Category Emotion Map

| Category | Common Starting Emotions | Safer Emotional Shift | First-Frame Feel |
| --- | --- | --- | --- |
| Fitness / gamification | shame, competitiveness, curiosity, pride | "called out" -> challenge | gym/car/bedroom selfie, rank reaction, petty motivation |
| Finance / budgeting | anxiety, avoidance, embarrassment, control-seeking | money fog -> agency | kitchen table bills, couch banking check, payday reflection |
| Productivity / planning | overwhelm, scattered attention, relief | chaos -> order | desk clutter, late-night laptop, calendar panic |
| Photo / video / creator tools | self-expression, surprise, skepticism, delight | ordinary input -> impressive output | desk review, couch reaction, before/after reveal face |
| Education / language | confusion, insecurity, progress pride | "I don't get it" -> small win | desk/study selfie, notebook mess, quiet confidence |
| Games / entertainment | curiosity, status, humor, FOMO | boredom -> identity/status | couch/gaming setup, reaction face, friend challenge |
| Utility / scanner / AI helper | annoyance, friction, relief | chore -> solved | kitchen/car/errand setting, "why did this work" reaction |
| Dating / relationships | uncertainty, embarrassment, hope, boundaries | confusion -> clarity | bathroom reset, car voice note, walking reflection |
| Wellness / mental health adjacent | stress, numbness, reflection, quiet relief | overwhelm -> support/agency | bedroom, walk, soft morning, contained emotion |
| Shopping / resale | curiosity, disbelief, opportunity | guesswork -> payoff | thrift aisle, car after purchase, receipt/result reaction |

## Emotional Arc Library

Use a fixed arc library. Do not let the script agent invent emotional arcs freely.

| Arc | Shape | Best For |
| --- | --- | --- |
| `raw_to_relief` | hurt/shaken -> tentative relief | fresh heartbreak, immediate emotional pain |
| `mask_slip` | pretending fine -> honest pain -> steadier | public/private contradiction |
| `numb_to_spark` | flat/numb -> small agency | low-energy grief, doomscrolling, 2am spirals |
| `rant_release` | anger -> pattern recognition -> calmer boundary | betrayal, mixed signals, disappearing acts |
| `spiral_to_clarity` | obsessive uncertainty -> structured reflection | rereading texts, overthinking, "what did that mean?" |
| `quiet_rebuild` | tired but composed -> small hopeful step | day-after, week-after, routine/recovery |
| `retrospective` | calm present -> past pain -> proof of progress | safest Meta-style framing |
| `discovery` | mild frustration -> useful discovery | utility/less sensitive app categories |
| `challenge_acceptance` | called out -> competitive action | fitness, games, learning, streak apps |
| `chaos_to_control` | overwhelmed -> organized | finance, productivity, planning, family/admin apps |
| `skeptic_to_surprised` | doubt -> proof reaction | AI tools, photo/video, scanner, utility apps |
| `ordinary_to_magic` | mundane input -> delightful output | creator tools, image/video, music, personalization |
| `status_reveal` | curiosity -> self-comparison -> challenge | ranks, scores, diagnostics, gamified apps |
| `mistake_to_fix` | embarrassing miss -> useful correction | language, writing, finance, fitness form, reminders |

Hard rule: every arc ends with small agency, proof, or a next step, not a miracle. The
product appears at the inflection point, not at peak distress or peak frustration.

## Emotional Jobs

These are starting states the script agent can choose. Pick from the app category and
proof type.

- `raw_pain`: quietly crying, shaken, overwhelmed
- `contained_pain`: numb, flat voice, trying to function
- `performing_okay`: smiling but visibly not fine
- `anger_clarity`: hurt turning into boundaries or answers
- `spiral`: replaying texts, checking signs, obsessive uncertainty
- `quiet_rebuild`: post-breakup recovery, small hopeful step
- `social_confession`: embarrassed, honest, "I did this and it helped"
- `proof_relief`: app gave structure, insight, or a next action
- `called_out`: creator feels exposed by a score, rank, or result
- `petty_competitive`: playful competitiveness or "I took that personally"
- `skeptical_try`: creator expects the tool to fail, then reacts
- `delighted_surprise`: creator is genuinely impressed by the result
- `quiet_focus`: desk/study/workflow concentration
- `admin_overwhelm`: bills, tasks, schedule, errands, inbox, or clutter piling up
- `status_curiosity`: "what does this say about me?"
- `embarrassed_fix`: small public/private mistake corrected by the app

## UGC Selfie Format Menu

Each format should carry defaults for camera, lighting, intensity, safety risk, and proof
placement.

| Format | Visual Default | Emotional Fit | Notes |
| --- | --- | --- | --- |
| `3am_spiral` | dark bedroom, phone glow, unmade bed | `spiral_to_clarity`, `numb_to_spark` | powerful but higher sensitivity |
| `bedroom_confession` | close selfie, low light, private room | `raw_to_relief`, `contained_pain` | workhorse heartbreak format |
| `bathroom_mirror_reset` | post-cry composure, fixing hair | `mask_slip` | strong "pretending fine" setup |
| `car_parked_rant` | parked car, overcast glare, seatbelt | `rant_release`, `raw_to_relief` | high authenticity; never imply driving |
| `walking_voice_note` | grey pavement, hoodie, deep phone focus | `quiet_rebuild`, `rant_release` | reflective, story-like |
| `texts_on_screen_reaction` | creator reacting to text/mixed signals | `spiral_to_clarity` | use deterministic/fake-fiction text carefully |
| `friend_sent_this` | softer trust angle, couch/kitchen | `discovery`, `proof_relief` | lower-risk intro to sensitive apps |
| `before_date_check` | anxious but composed, mirror/car | `contained_pain` | avoid manipulation/revenge framing |
| `stitch_rebuttal` | responding to bad advice/myth | `anger_clarity` | good for "everyone says just move on" |
| `day_after_update` | daylight, calmer, proof-oriented | `retrospective`, `quiet_rebuild` | safest brand/policy route |
| `retrospective_check_in` | kitchen/desk daylight, calmer present tense | `retrospective`, `proof_relief` | good for sensitive categories and Meta |
| `time_jump_diptych` | same identity night -> daylight | `raw_to_relief`, `retrospective` | strong but identity consistency must pass |
| `desk_overwhelm` | laptop, papers, late-night desk | `chaos_to_control`, `mistake_to_fix` | productivity, finance, education |
| `kitchen_table_bills` | kitchen table, laptop, receipts/bills | `chaos_to_control`, `proof_relief` | finance/admin apps; avoid visible fake numbers |
| `kitchen_counter_flat` | ordinary kitchen counter, flat overhead light | `proof_relief`, `skeptic_to_surprised` | utility, scanner, food, family/admin apps |
| `gym_rank_reaction` | gym/car post-workout selfie | `status_reveal`, `challenge_acceptance` | fitness/gamified apps |
| `couch_reaction` | casual home reaction to result | `skeptic_to_surprised`, `ordinary_to_magic` | AI/photo/video/games |
| `errand_demo` | car/kitchen/store aisle after chore | `proof_relief`, `skeptic_to_surprised` | utility/scanner/shopping |
| `study_check_in` | notebook/laptop, tired but focused | `mistake_to_fix`, `quiet_focus` | education/language |
| `creator_desk_review` | laptop/mic/phone, non-studio setup | `discovery`, `skeptic_to_surprised` | SaaS/creator tools |
| `friend_challenge` | casual social challenge energy | `status_reveal`, `challenge_acceptance` | games, fitness, quizzes, ranks |

## Beat To Visual Mapping

Every script beat should carry visual instructions. This lets the Render Planner assemble
image prompts and choose proof timing without guessing.

| Beat | Script Role | Visual Role |
| --- | --- | --- |
| `hook` | emotional scroll stop | most expressive first frame; face carries the feeling |
| `pain_detail` | specific relatable truth | tighter crop, eye/hand tension, messy environment |
| `turn` | first move toward agency | posture steadies, phone/app may enter frame |
| `payload` | app reveal | calmer face, proof can begin |
| `proof` | verified feature/result | screen recording/proof overlay aligned to spoken line |
| `reinforcement` | personal specificity | creator reaction to what the app showed |
| `cta` | grounded action | composed, not euphoric; "try this" not "this fixed me" |

Proof should not overlap the rawest emotional moment. As a product rule, avoid proof
cutaways when `emotion_intensity > 0.6`; let the face carry the hook, then show proof at
the turn/payload/proof beats.

## Prompt Token Strategy

For emotional faces, avoid theatrical labels. Models often overdo words like "crying" or
"sobbing." Prefer aftermath and micro-expression tokens.

### Safer Emotional Tokens

- `red-rimmed eyes`
- `recently wiped cheeks`
- `slightly swollen eyelids`
- `tight jaw`
- `lips pressed together`
- `flat affect`
- `slow blink`
- `eyes drifting just off-lens`
- `smile that does not reach the eyes`
- `one micro-frown`
- `watery eyes, contained`
- `jaw tension, brows raised`

### Avoid Or Use Sparingly

- `sobbing`
- `meltdown`
- `panic attack`
- `breakdown`
- `hysterical`
- `devastated beyond repair`
- `self-harm`
- `hospital`
- `mascara streaks`
- `violent rage`

## Sensitive App Guardrails

For sensitive apps, choose guardrails by `riskTier`.

### Normal Risk

For utilities, games, photo tools, education, productivity, shopping, and most creator
tools:

- Avoid fake proof, fake UI, fake testimonials, fake ratings, and unsupported outcomes.
- Keep embarrassment playful, not humiliating.
- Do not turn a small mistake into a serious personal attack.
- If the first frame is intense, the payoff must be visible and believable.

### Financial Sensitive

For budgeting, investing, debt, income, taxes, or savings apps:

- Do not promise guaranteed financial outcomes or imply wealth.
- Avoid shame-heavy copy such as "you're broke because..." or "you are bad with money."
- Use "helped me see," "organized my spending," "showed where money went," not "fixed my finances."
- Visible numbers/currency in proof must match real product evidence.

### Body Image / Fitness Sensitive

For weight, body, food, gym, or health-adjacent apps:

- Prefer performance, consistency, strength, rank, streak, or skill framing over body shame.
- Avoid "fix your body," "burn fat fast," "you look bad," or unrealistic transformation claims.
- If using shame/competitiveness, keep it playful and self-directed.
- Proof must not invent body metrics, health scores, or before/after results.

### Mental Health Adjacent / Relationship Sensitive

For heartbreak, mental-health-adjacent, wellness, or relationship-processing apps:

- Use first-person creator experience, not second-person diagnosis.
- Avoid "you are heartbroken/anxious/depressed" targeting language.
- Do not imply medical treatment, therapy, diagnosis, crisis response, or guaranteed
  emotional outcomes unless verified and allowed.
- Do not show self-harm cues, threats, panic attacks, alcohol/medication coping, or
  extreme breakdowns.
- Prefer agency verbs: reflect, organize, write, understand, prepare, process, decide,
  document.
- Avoid stalking, revenge, manipulation, diagnosing an ex, obsessive monitoring, or
  "make them come back" framing.
- If using crying imagery, keep it contained and human: tears or red eyes, not collapse.
- The product should feel like a supportive tool during emotional confusion, not a cure
  or crisis intervention.

### Medical Or Safety Sensitive

For medical, sleep-health, crisis, physical safety, or similar apps:

- Verify every claim from product truth before scripting.
- Avoid diagnosis, cure, prevention, emergency-response, or guaranteed safety language
  unless legally/product-approved.
- Avoid intense crisis imagery unless the product is actually designed and approved for
  that context.
- Prefer tracking, logging, reminders, awareness, or preparation language where accurate.

QA hard gates:

- `distress_ceiling_respected`
- `resolution_present`
- `claims_verified`
- `no_personal_attribute_targeting`
- `no_crisis_or_medical_claims`
- `ad_usability`
- `identity_consistency`

## General Product Schema

The schema should be generic. Mendora is only a worked example after this section.

```jsonc
{
  "creativeId": "app-category-format-001",
  "appId": "example_app",
  "appCategory": "fitness | finance | productivity | photo_video | education | utility | game | wellness | dating | shopping",
  "riskTier": "normal | financial_sensitive | body_image_sensitive | mental_health_adjacent | medical_or_safety_sensitive",
  "productTruth": {
    "allowedClaims": ["verified claim or feature"],
    "blockedClaims": ["unsupported or risky claim"],
    "proofObjects": ["proof_id_or_asset_key"]
  },
  "creativeStrategy": {
    "userJob": "what the viewer is trying to do",
    "audienceTension": "life before the app",
    "desiredShift": "emotion before -> emotion after",
    "emotionalArc": "chaos_to_control",
    "startingEmotion": "admin_overwhelm",
    "endingEmotion": "proof_relief",
    "ugcFormat": "desk_overwhelm",
    "peakIntensity": 0.55
  },
  "creatorDirection": {
    "persona": "ordinary creator matching the audience",
    "performanceStyle": "underplayed, realistic, not theatrical",
    "voiceEnergy": "confessional | amused | skeptical | excited | annoyed | calm",
    "avoid": ["category-specific avoid list"]
  },
  "beats": [
    {
      "beatId": "hook",
      "line": "organic spoken hook",
      "function": "emotional_hook",
      "emotion": {
        "primary": "admin_overwhelm",
        "intensity": 0.55,
        "valence": -0.45
      },
      "visual": {
        "face": ["tired eyes", "half-laugh of disbelief"],
        "body": ["leaning over laptop", "one hand in hair"],
        "environment": ["messy desk", "late-night laptop glow"],
        "camera": ["front-facing selfie", "slight low angle", "handheld"]
      },
      "cutaway": { "type": "none" },
      "isFirstFrameSource": true
    },
    {
      "beatId": "proof",
      "line": "spoken line that exactly matches visible proof",
      "function": "verified_product_proof",
      "emotion": {
        "primary": "proof_relief",
        "intensity": 0.35,
        "valence": 0.4
      },
      "cutaway": {
        "type": "proof_overlay",
        "proofId": "verified_proof_object_id",
        "spokenLineUnderCutaway": "spoken line that exactly matches visible proof"
      }
    }
  ],
  "firstFramePromptCandidates": [
    {
      "beatRef": "hook",
      "variant": "overwhelmed_but_ad_usable",
      "positive": "assembled from app category, ugc format, emotion tokens, and realism recipe",
      "negative": "shared negatives plus category-specific risk negatives",
      "editRefinement": "v4-style realism edit that preserves person, scene, and emotional state"
    }
  ],
  "qaExpectations": {
    "minAverageScore": 4,
    "hardGates": [
      "ad_usability",
      "identity_consistency",
      "claims_verified",
      "proof_alignment",
      "risk_tier_guardrails"
    ]
  }
}
```

## Category Examples

### Fitness / Gamified Progress

- Arc: `status_reveal` or `challenge_acceptance`
- Format: `gym_rank_reaction`, `car_parked_rant`, `friend_challenge`
- First frame: creator looks personally called out by a rank/score, half amused and half
  offended.
- Hook shape: "I found out my legs were ranked lower than my arms and I took that personally."
- Proof: rank screen, XP, streak, completed workout, real product state.

### Finance / Budgeting

- Arc: `chaos_to_control`
- Format: `desk_overwhelm`, `kitchen_table_bills`, `day_after_update`
- First frame: late-night desk or kitchen table, embarrassed half-laugh, bills or laptop.
- Hook shape: "I thought I was being responsible until I saw where my money was actually going."
- Proof: spending breakdown, budget category, bill reminder, real dashboard.

### Photo / Video / Creator Tool

- Arc: `skeptic_to_surprised` or `ordinary_to_magic`
- Format: `creator_desk_review`, `couch_reaction`, `errand_demo`
- First frame: skeptical face before result, then delight/reaction after output.
- Hook shape: "I thought this was going to look fake, and now I'm annoyed that it worked."
- Proof: before/after, generated result, export screen.

### Productivity / Planning

- Arc: `chaos_to_control`
- Format: `desk_overwhelm`, `walking_voice_note`, `day_after_update`
- First frame: cluttered desk, tired eyes, tabs/tasks open, flat laptop glow.
- Hook shape: "This is what my brain looked like before I put everything in one place."
- Proof: task list, schedule, focus plan, reminder flow.

### Education / Language

- Arc: `mistake_to_fix` or `quiet_focus`
- Format: `study_check_in`, `desk_overwhelm`, `walking_voice_note`
- First frame: notebook mess, late study, embarrassed but determined.
- Hook shape: "I kept making the same mistake and didn't know why."
- Proof: correction explanation, quiz result, lesson progress.

### Utility / Scanner / Everyday AI

- Arc: `skeptic_to_surprised` or `proof_relief`
- Format: `errand_demo`, `car_parked_rant`, `kitchen_counter_flat`
- First frame: annoyed errand/chore moment.
- Hook shape: "I downloaded this because I was too tired to figure it out manually."
- Proof: scan result, generated answer, saved step.

### Games / Entertainment

- Arc: `status_reveal`, `discovery`, or `challenge_acceptance`
- Format: `couch_reaction`, `friend_challenge`, `walking_voice_note`
- First frame: curiosity, competitive smile, "wait, what did I just get?"
- Hook shape: "This app told me what type of player I am and I hate that it's accurate."
- Proof: result card, rank, personalized output.

## Mendora Worked Schema Example

```jsonc
{
  "creativeId": "mendora-night-confession-001",
  "appId": "mendora",
  "sensitivityLevel": "heartbreak_mental_health_adjacent",
  "productTruth": {
    "allowedClaims": [
      "organize your thoughts",
      "spot patterns",
      "get a clearer next step"
    ],
    "blockedClaims": [
      "cures heartbreak",
      "diagnoses your ex",
      "guarantees closure",
      "makes them come back"
    ]
  },
  "creativeStrategy": {
    "audienceState": "fresh_breakup_confusion",
    "emotionalArc": "spiral_to_clarity",
    "startingEmotion": "numb_after_crying",
    "endingEmotion": "quiet_agency",
    "ugcFormat": "3am_spiral",
    "peakIntensity": 0.7
  },
  "creatorDirection": {
    "persona": "late-20s woman processing a breakup privately",
    "performanceStyle": "underplayed, realistic, not theatrical",
    "voiceEnergy": "quiet, confessional",
    "avoid": [
      "melodrama",
      "medical crisis cues",
      "revenge framing",
      "active sobbing"
    ]
  },
  "beats": [
    {
      "beatId": "hook",
      "timeRange": [0, 3],
      "line": "I kept rereading his last text like it was going to change.",
      "function": "emotional_hook",
      "emotion": {
        "primary": "numb_spiral",
        "intensity": 0.7,
        "valence": -0.7
      },
      "visual": {
        "face": ["red-rimmed eyes", "blank tired stare", "lips pressed together"],
        "body": ["sitting in bed", "shoulders slightly hunched", "phone near chest"],
        "environment": ["dark bedroom", "phone glow", "unmade bed"],
        "camera": ["front-facing selfie", "close crop", "handheld"],
        "framing": ["face 15% off-center", "top of hair nearly cropped"]
      },
      "cutaway": { "type": "none" },
      "isFirstFrameSource": true
    },
    {
      "beatId": "turn",
      "timeRange": [7, 11],
      "line": "So I put the whole situation into Mendora instead.",
      "function": "app_introduction",
      "emotion": {
        "primary": "tentative_control",
        "intensity": 0.45,
        "valence": 0.1
      },
      "visual": {
        "face": ["steadier eyes", "less jaw tension"],
        "body": ["phone lowers slightly"]
      },
      "cutaway": { "type": "none" }
    },
    {
      "beatId": "proof",
      "timeRange": [11, 17],
      "line": "It helped me separate what happened from what I was imagining.",
      "function": "verified_product_proof",
      "emotion": {
        "primary": "relief_without_overclaiming",
        "intensity": 0.35,
        "valence": 0.35
      },
      "cutaway": {
        "type": "proof_overlay",
        "proofId": "mendora_reflection_summary_screen",
        "spokenLineUnderCutaway": "It helped me separate what happened from what I was imagining."
      }
    }
  ],
  "firstFramePromptCandidates": [
    {
      "beatRef": "hook",
      "variant": "numb_stare",
      "positive": "Vertical 9:16 paused first frame from a handheld iPhone front-camera video. Late-20s woman sitting in bed at 3am after crying, red-rimmed eyes, blank exhausted stare, phone glow lighting her face, messy dark bedroom, unmade bed, natural skin texture, imperfect real-life lighting, emotionally restrained, not glamorous.",
      "negative": "active sobbing, dramatic crying, self-harm cues, hospital, bruises, alcohol, medication bottle, glam makeup, cinematic lighting, perfect influencer pose, text overlay, app UI, visible recording phone",
      "editRefinement": "Preserve the same person, bedroom, hoodie, pose, and framing. Make it look like an unedited iPhone front-camera TikTok draft: flatter low light, normal phone deep focus, mild social compression, red-rimmed eyes, recently wiped cheeks, contained emotion, not theatrical."
    }
  ],
  "qaExpectations": {
    "minAverageScore": 4,
    "hardGates": [
      "ad_usability",
      "identity_consistency",
      "distress_ceiling_respected",
      "resolution_present",
      "claims_verified",
      "no_personal_attribute_targeting",
      "no_crisis_or_medical_claims"
    ]
  }
}
```

## Mendora Example Directions

### 1. Numb Spiral

- Format: `3am_spiral`
- Arc: `spiral_to_clarity`
- Hook: "I kept rereading his last text like it was going to change."
- First frame: bed, phone glow, red-rimmed eyes, blank stare.
- Product turn: the app becomes the place the thought goes instead of another text.
- Proof: reflection/journal summary or pattern breakdown.
- CTA: "Write it out before you send it."

### 2. Angry Clarity

- Format: `car_parked_rant`
- Arc: `rant_release`
- Hook: "No, because why did I apologize after he disappeared for three days?"
- First frame: parked car, jaw tight, brows raised, overcast windshield glare.
- Product turn: app helps separate the event from the self-blame.
- Proof: pattern/relationship prompt or boundary-prep screen.
- CTA: "Run it through Mendora before you text back."

### 3. Pretending To Be Fine

- Format: `bathroom_mirror_reset`
- Arc: `mask_slip`
- Hook: "This is me pretending I'm not about to cry at brunch."
- First frame: bathroom mirror, forced small smile, watery eyes, fixing hair.
- Product turn: private check-in before social performance.
- Proof: guided reflection, calming summary, or next-step prompt.
- CTA: "Take two minutes before you go back out there."

### 4. Quiet Rebuild

- Format: `walking_voice_note`
- Arc: `quiet_rebuild`
- Hook: "The weirdest part after a breakup is not knowing what to do with all the thoughts."
- First frame: grey morning walk selfie, tired but composed.
- Product turn: app as daily processing ritual.
- Proof: trend/log/reflection history if real.
- CTA: "Start with one thought."

### 5. Day 21 No-Contact

- Format: `day_after_update` or `retrospective_check_in`
- Arc: `retrospective`
- Hook: "Day 21 of not sending the paragraph."
- First frame: kitchen/daylight, calmer face, still a little tired.
- Product turn: the app helped route the urge into a private reflection.
- Proof: no-contact/check-in/streak only if the app truly has it.
- CTA: "Put the paragraph somewhere safer."

### 6. Time-Jump Diptych

- Format: `time_jump_diptych`
- Arc: `raw_to_relief`
- Hook: "These two videos are three weeks apart."
- First frame A: night bedroom, red-rimmed eyes.
- First frame B: daylight walk/kitchen, calmer but not euphoric.
- Product turn: same app, small repeated process.
- QA: identity consistency must pass across both anchors.

## Product Recommendation

Add an `Emotion Plan` step inside the Script Agent:

1. Verify product truth and blocked claims.
2. Research audience language when possible.
3. Select emotional arc, UGC format, intensity ceiling, and proof role.
4. Draft script beats with emotion and visual state per beat.
5. Generate first-frame prompt candidates from schema.
6. Run the existing candidate -> anchor -> realism-edit -> QA loop.
7. Animate only approved anchors.

This keeps Mobile Ad Agent from becoming prompt-first. The user still starts with the app
URL/proof, but the creative pack can show purposeful emotional directions instead of a
generic "UGC selfie" toggle.
