"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  CONTENT_TYPE_DESCRIPTIONS,
  CONTENT_TYPE_LABELS,
  ContentType,
  ProjectIntakeFormState,
  ProjectSummaryQueryResult
} from "../../lib/types";
import { useConvexAvailability } from "../../lib/convex-client-provider";
import {
  projectIntakeMutations,
  projectIntakeQueries
} from "../../lib/convex";

const DEFAULT_FORM: ProjectIntakeFormState = {
  title: "",
  contentType: "blog_post",
  desiredOutcome: "",
  targetAudience: "",
  publishingPlan: "",
  timeline: "",
  materialsInventory: "",
  communicationPreferences: "",
  availability: "",
  budgetRange: "",
  voiceTone: "",
  voiceStructure: "",
  voiceContent: ""
};

const STEPS = [
  { id: "overview", label: "Project overview" },
  { id: "audience", label: "Audience & outcomes" },
  { id: "plan", label: "Plan & logistics" },
  { id: "voice", label: "Voice & guardrails" },
  { id: "review", label: "Review" }
] as const;

const STEP_FIELD_MAP: Record<(typeof STEPS)[number]["id"], (keyof ProjectIntakeFormState)[]> = {
  overview: ["title", "contentType"],
  audience: ["desiredOutcome", "targetAudience"],
  plan: [
    "publishingPlan",
    "timeline",
    "materialsInventory",
    "communicationPreferences",
    "availability",
    "budgetRange"
  ],
  voice: ["voiceTone", "voiceStructure", "voiceContent"],
  review: []
};

interface LocalDraftPayload {
  values: ProjectIntakeFormState;
  step: number;
  savedAt: string;
}

type FieldChangeHandler = <K extends keyof ProjectIntakeFormState>(
  field: K,
  value: ProjectIntakeFormState[K]
) => void;

export function ProjectIntakeFlow({ projectId }: { projectId?: string }) {
  const { isConfigured } = useConvexAvailability();

  return (
    <ConnectedIntakeFlow projectId={projectId} convexConfigured={isConfigured} />
  );
}

function ConnectedIntakeFlow({
  projectId,
  convexConfigured
}: {
  projectId?: string;
  convexConfigured: boolean;
}) {
  if (!projectId) {
    return (
      <IntakeForm
        projectId={undefined}
        existingData={null}
        convexConfigured={convexConfigured}
      />
    );
  }

  if (!convexConfigured) {
    return (
      <section className="card">
        <h2>Edit project definition</h2>
        <p className="muted">
          Connect a Convex deployment before editing an existing project. Blueprint
          data syncs from Convex, so offline editing is disabled.
        </p>
      </section>
    );
  }

  return (
    <ExistingProjectIntake
      projectId={projectId}
      convexConfigured={convexConfigured}
    />
  );
}

function ExistingProjectIntake({
  projectId,
  convexConfigured
}: {
  projectId: string;
  convexConfigured: boolean;
}) {
  const project = useQuery(projectIntakeQueries.getProjectSummary, { projectId });

  if (project === undefined) {
    return (
      <section className="card">
        <h2>Edit project definition</h2>
        <p className="muted">Loading project details…</p>
      </section>
    );
  }

  if (!project) {
    return (
      <section className="card">
        <h2>Project not found</h2>
        <p className="muted">
          The requested project does not exist. Return to the home page to start a new
          intake.
        </p>
      </section>
    );
  }

  return (
    <IntakeForm
      projectId={projectId}
      existingData={project}
      convexConfigured={convexConfigured}
    />
  );
}

function IntakeForm({
  projectId,
  existingData,
  convexConfigured
}: {
  projectId?: string;
  existingData: ProjectSummaryQueryResult | null;
  convexConfigured: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProjectIntakeFormState>(DEFAULT_FORM);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectIntakeFormState, string>>>(
    {}
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState<string | null>(null);
  const [pendingLocalDraft, setPendingLocalDraft] = useState<LocalDraftPayload | null>(
    null
  );
  const [hasAppliedLocalDraft, setHasAppliedLocalDraft] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const storageKey = useMemo(
    () => (projectId ? `project-intake-draft:${projectId}` : "project-intake-draft:new"),
    [projectId]
  );

  const applyLocalDraft = useCallback(
    (draft: LocalDraftPayload) => {
      setValues(draft.values);
      setCurrentStep(Math.min(draft.step, STEPS.length - 1));
      setHasAppliedLocalDraft(true);
    },
    [setValues, setCurrentStep, setHasAppliedLocalDraft]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as LocalDraftPayload;
      if (!projectId) {
        applyLocalDraft(parsed);
      } else {
        setPendingLocalDraft(parsed);
      }
    } catch (error) {
      console.warn("Failed to load intake draft", error);
    }
  }, [storageKey, projectId, applyLocalDraft]);

  useEffect(() => {
    if (!existingData) {
      return;
    }
    if (pendingLocalDraft && !hasAppliedLocalDraft) {
      // Keep the draft until the user decides which source to use.
      return;
    }
    setValues(mapProjectToForm(existingData));
    setCurrentStep(0);
  }, [existingData, pendingLocalDraft, hasAppliedLocalDraft]);

  const createProject = useMutation(
    projectIntakeMutations.createProjectWithBlueprint
  );
  const updateProject = useMutation(projectIntakeMutations.updateProjectBlueprint);

  const handleFieldChange = <K extends keyof ProjectIntakeFormState>(
    field: K,
    value: ProjectIntakeFormState[K]
  ) => {
    setValues((previous) => ({
      ...previous,
      [field]: value
    }));
    setErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleNext = () => {
    const stepKey = STEPS[currentStep].id;
    const stepErrors = validateStep(stepKey, values);
    if (Object.keys(stepErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...stepErrors }));
      const firstErrorField = Object.keys(stepErrors)[0] as keyof ProjectIntakeFormState;
      const errorStepIndex = findStepIndexForField(firstErrorField);
      if (errorStepIndex > currentStep) {
        setCurrentStep(errorStepIndex);
      }
      return;
    }

    setCurrentStep((index) => Math.min(STEPS.length - 1, index + 1));
  };

  const handlePrevious = () => {
    setCurrentStep((index) => Math.max(0, index - 1));
  };

  const handleSaveDraft = () => {
    if (typeof window === "undefined") {
      return;
    }
    const payload: LocalDraftPayload = {
      values,
      step: currentStep,
      savedAt: new Date().toISOString()
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    setPendingLocalDraft(payload);
    setDraftBanner("Draft saved locally");
  };

  const handleApplyDraft = () => {
    if (!pendingLocalDraft) {
      return;
    }
    applyLocalDraft(pendingLocalDraft);
    setDraftBanner(
      `Draft from ${new Date(pendingLocalDraft.savedAt).toLocaleString()} restored`
    );
  };

  const handleClearDraft = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(storageKey);
    setPendingLocalDraft(null);
    setHasAppliedLocalDraft(false);
    setDraftBanner("Draft cleared");
    if (existingData) {
      setValues(mapProjectToForm(existingData));
      setCurrentStep(0);
    }
  };

  const handleSubmit = async () => {
    if (!convexConfigured) {
      setFormError("Connect your Convex deployment before saving the intake.");
      return;
    }

    const validation = validateAll(values);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      const firstErrorField = Object.keys(validation)[0] as keyof ProjectIntakeFormState;
      setCurrentStep(findStepIndexForField(firstErrorField));
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const voiceGuardrails = buildVoiceGuardrails(values);
      const payload = {
        project: {
          title: values.title.trim(),
          contentType: values.contentType,
          goal: values.desiredOutcome.trim(),
          status: existingData?.project.status ?? "planning"
        },
        blueprint: {
          desiredOutcome: values.desiredOutcome.trim(),
          targetAudience: values.targetAudience.trim(),
          publishingPlan: values.publishingPlan.trim(),
          timeline: values.timeline.trim(),
          materialsInventory: values.materialsInventory.trim(),
          communicationPreferences: values.communicationPreferences.trim(),
          availability: values.availability.trim(),
          budgetRange: values.budgetRange.trim() || undefined,
          voiceGuardrails
        }
      };

      if (projectId) {
        const result = await updateProject({
          projectId,
          ...payload
        });
        clearDraftFromStorage();
        router.push(`/projects/${result.projectId ?? projectId}`);
      } else {
        const result = await createProject({
          ownerExternalId: "demo-user",
          ownerName: "Demo User",
          ...payload
        });
        clearDraftFromStorage();
        router.push(`/projects/${result.projectId}`);
      }
    } catch (error) {
      console.error("Failed to submit intake", error);
      setFormError("We couldn’t save the intake. Please verify your Convex deployment and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const suggestionDisabled = values.desiredOutcome.trim().length === 0;

  return (
    <section className="card">
      <header style={{ marginBottom: "1rem" }}>
        <h2>{projectId ? "Edit project definition" : "Project definition intake"}</h2>
        <p className="muted">
          {projectId
            ? `Last saved ${formatTimestamp(existingData?.project.updatedAt)}`
            : "Capture the blueprint before your first realtime session. Save drafts locally or push directly to Convex."}
        </p>
      </header>

      {!convexConfigured && (
        <div className="callout" style={{ marginBottom: "1.25rem" }}>
          <p style={{ margin: 0 }}>
            Set <code>NEXT_PUBLIC_CONVEX_URL</code> to sync blueprints. You can still
            rehearse the intake and save a local draft, but persistence to Convex is
            disabled.
          </p>
        </div>
      )}

      {pendingLocalDraft && projectId && !hasAppliedLocalDraft && (
        <div className="callout" style={{ marginBottom: "1.25rem" }}>
          <p style={{ margin: 0 }}>
            A local draft from {new Date(pendingLocalDraft.savedAt).toLocaleString()} is
            available.
          </p>
          <div className="button-row" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="button secondary" onClick={handleApplyDraft}>
              Use local draft
            </button>
            <button type="button" className="button ghost" onClick={handleClearDraft}>
              Dismiss draft
            </button>
          </div>
        </div>
      )}

      {draftBanner && <p className="muted">{draftBanner}</p>}
      {formError && <p className="error-text">{formError}</p>}

      <nav className="step-indicator" aria-label="Intake progress">
        {STEPS.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={index === currentStep ? "active" : ""}
            onClick={() => setCurrentStep(index)}
            disabled={index > currentStep + 1}
          >
            {index + 1}. {step.label}
          </button>
        ))}
      </nav>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (currentStep === STEPS.length - 1) {
            void handleSubmit();
          } else {
            handleNext();
          }
        }}
      >
        {STEPS[currentStep].id === "overview" && (
          <OverviewStep
            values={values}
            errors={errors}
            onChange={handleFieldChange}
            onSuggestTitle={() =>
              handleFieldChange("title", buildTitleSuggestion(values))
            }
            suggestionDisabled={suggestionDisabled}
          />
        )}
        {STEPS[currentStep].id === "audience" && (
          <AudienceStep values={values} errors={errors} onChange={handleFieldChange} />
        )}
        {STEPS[currentStep].id === "plan" && (
          <PlanStep values={values} errors={errors} onChange={handleFieldChange} />
        )}
        {STEPS[currentStep].id === "voice" && (
          <VoiceStep values={values} errors={errors} onChange={handleFieldChange} />
        )}
        {STEPS[currentStep].id === "review" && (
          <ReviewStep values={values} onEdit={(stepId) => setCurrentStep(stepId)} />
        )}

        <div className="button-row">
          {currentStep > 0 && (
            <button type="button" className="button ghost" onClick={handlePrevious}>
              Back
            </button>
          )}
          {currentStep < STEPS.length - 1 && (
            <button type="submit" className="button secondary">
              Continue
            </button>
          )}
          {currentStep === STEPS.length - 1 && (
            <button
              type="submit"
              className="button"
              disabled={isSaving || !convexConfigured}
              title={
                convexConfigured
                  ? undefined
                  : "Connect Convex to enable project creation"
              }
            >
              {isSaving
                ? "Saving…"
                : projectId
                  ? "Update blueprint"
                  : "Create project"}
            </button>
          )}
          <button type="button" className="button ghost" onClick={handleSaveDraft}>
            Save draft
          </button>
          <button type="button" className="button ghost" onClick={handleClearDraft}>
            Clear draft
          </button>
        </div>
      </form>
    </section>
  );

  function clearDraftFromStorage() {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(storageKey);
  }
}

function OverviewStep({
  values,
  errors,
  onChange,
  onSuggestTitle,
  suggestionDisabled
}: {
  values: ProjectIntakeFormState;
  errors: Partial<Record<keyof ProjectIntakeFormState, string>>;
  onChange: FieldChangeHandler;
  onSuggestTitle: () => void;
  suggestionDisabled: boolean;
}) {
  return (
    <div>
      <div className="field">
        <label htmlFor="project-title">Project title</label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            id="project-title"
            name="project-title"
            value={values.title}
            onChange={(event) => onChange("title", event.target.value)}
            aria-invalid={Boolean(errors.title)}
            placeholder="e.g., Leading with Clarity"
          />
          <button
            type="button"
            className="button secondary"
            onClick={onSuggestTitle}
            disabled={suggestionDisabled}
            title={
              suggestionDisabled
                ? "Describe the desired outcome to generate a suggestion"
                : "Generate a title suggestion"
            }
          >
            Suggest title
          </button>
        </div>
        {errors.title && <span className="error-text">{errors.title}</span>}
        <small>
          Optional AI suggestions remix your goals and audience to spark the right
          framing. Update the generated title before saving.
        </small>
      </div>

      <div className="field">
        <label htmlFor="content-type">Content type</label>
        <select
          id="content-type"
          name="content-type"
          value={values.contentType}
          onChange={(event) =>
            onChange("contentType", event.target.value as ContentType)
          }
        >
          {Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <small>{CONTENT_TYPE_DESCRIPTIONS[values.contentType]}</small>
      </div>
    </div>
  );
}

function AudienceStep({
  values,
  errors,
  onChange
}: {
  values: ProjectIntakeFormState;
  errors: Partial<Record<keyof ProjectIntakeFormState, string>>;
  onChange: FieldChangeHandler;
}) {
  return (
    <div>
      <div className="field">
        <label htmlFor="desired-outcome">Desired outcomes / success metrics</label>
        <textarea
          id="desired-outcome"
          value={values.desiredOutcome}
          onChange={(event) => onChange("desiredOutcome", event.target.value)}
          aria-invalid={Boolean(errors.desiredOutcome)}
          placeholder="What impact should this project create for the reader and for you?"
        />
        {errors.desiredOutcome && (
          <span className="error-text">{errors.desiredOutcome}</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="target-audience">Target audience description</label>
        <textarea
          id="target-audience"
          value={values.targetAudience}
          onChange={(event) => onChange("targetAudience", event.target.value)}
          aria-invalid={Boolean(errors.targetAudience)}
          placeholder="Who should feel seen in this piece? Include roles, motivations, and anxieties."
        />
        {errors.targetAudience && (
          <span className="error-text">{errors.targetAudience}</span>
        )}
      </div>
    </div>
  );
}

function PlanStep({
  values,
  errors,
  onChange
}: {
  values: ProjectIntakeFormState;
  errors: Partial<Record<keyof ProjectIntakeFormState, string>>;
  onChange: FieldChangeHandler;
}) {
  return (
    <div>
      <div className="field">
        <label htmlFor="publishing-plan">Publishing plan</label>
        <textarea
          id="publishing-plan"
          value={values.publishingPlan}
          onChange={(event) => onChange("publishingPlan", event.target.value)}
          aria-invalid={Boolean(errors.publishingPlan)}
          placeholder="Channels, partners, and promotional milestones."
        />
        {errors.publishingPlan && (
          <span className="error-text">{errors.publishingPlan}</span>
        )}
      </div>

      <div className="grid-columns two">
        <div className="field">
          <label htmlFor="timeline">Timeline expectations</label>
          <textarea
            id="timeline"
            value={values.timeline}
            onChange={(event) => onChange("timeline", event.target.value)}
            aria-invalid={Boolean(errors.timeline)}
            placeholder="Key dates, draft checkpoints, and launch deadline."
          />
          {errors.timeline && <span className="error-text">{errors.timeline}</span>}
        </div>

        <div className="field">
          <label htmlFor="materials">Available materials / research inventory</label>
          <textarea
            id="materials"
            value={values.materialsInventory}
            onChange={(event) => onChange("materialsInventory", event.target.value)}
            aria-invalid={Boolean(errors.materialsInventory)}
            placeholder="Interviews, data rooms, decks, previous coverage, testimonials, etc."
          />
          {errors.materialsInventory && (
            <span className="error-text">{errors.materialsInventory}</span>
          )}
        </div>
      </div>

      <div className="grid-columns two">
        <div className="field">
          <label htmlFor="communication">
            Communication preferences & cadence
          </label>
          <textarea
            id="communication"
            value={values.communicationPreferences}
            onChange={(event) => onChange("communicationPreferences", event.target.value)}
            aria-invalid={Boolean(errors.communicationPreferences)}
            placeholder="Preferred channels, feedback loops, and response expectations."
          />
          {errors.communicationPreferences && (
            <span className="error-text">{errors.communicationPreferences}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="availability">Availability</label>
          <textarea
            id="availability"
            value={values.availability}
            onChange={(event) => onChange("availability", event.target.value)}
            aria-invalid={Boolean(errors.availability)}
            placeholder="Interview windows, blackout dates, turnaround expectations."
          />
          {errors.availability && (
            <span className="error-text">{errors.availability}</span>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="budget">Budget guardrails</label>
        <input
          id="budget"
          value={values.budgetRange}
          onChange={(event) => onChange("budgetRange", event.target.value)}
          placeholder="e.g., $5k–$7k retainer, per-section approvals, etc."
        />
      </div>
    </div>
  );
}

function VoiceStep({
  values,
  errors,
  onChange
}: {
  values: ProjectIntakeFormState;
  errors: Partial<Record<keyof ProjectIntakeFormState, string>>;
  onChange: FieldChangeHandler;
}) {
  return (
    <div>
      <div className="field">
        <label htmlFor="voice-tone">Voice — tone & personality</label>
        <textarea
          id="voice-tone"
          value={values.voiceTone}
          onChange={(event) => onChange("voiceTone", event.target.value)}
          aria-invalid={Boolean(errors.voiceTone)}
          placeholder="e.g., Warm but authoritative, mix narrative stories with actionable frameworks."
        />
      </div>

      <div className="field">
        <label htmlFor="voice-structure">Voice — structure & pacing</label>
        <textarea
          id="voice-structure"
          value={values.voiceStructure}
          onChange={(event) => onChange("voiceStructure", event.target.value)}
          aria-invalid={Boolean(errors.voiceStructure)}
          placeholder="Open with a hook, include quick summaries, close each section with a next-step."
        />
      </div>

      <div className="field">
        <label htmlFor="voice-content">Voice — content guardrails</label>
        <textarea
          id="voice-content"
          value={values.voiceContent}
          onChange={(event) => onChange("voiceContent", event.target.value)}
          aria-invalid={Boolean(errors.voiceContent)}
          placeholder="Stories to prioritize, sensitive topics to avoid, references the AI should weave in."
        />
      </div>
    </div>
  );
}

function ReviewStep({
  values,
  onEdit
}: {
  values: ProjectIntakeFormState;
  onEdit: (stepIndex: number) => void;
}) {
  const sections: { title: string; fields: { label: string; value: string; stepIndex: number }[] }[] = [
    {
      title: "Project overview",
      fields: [
        { label: "Title", value: values.title, stepIndex: 0 },
        {
          label: "Content type",
          value: CONTENT_TYPE_LABELS[values.contentType],
          stepIndex: 0
        }
      ]
    },
    {
      title: "Audience & outcomes",
      fields: [
        { label: "Desired outcome", value: values.desiredOutcome, stepIndex: 1 },
        { label: "Target audience", value: values.targetAudience, stepIndex: 1 }
      ]
    },
    {
      title: "Plan & logistics",
      fields: [
        { label: "Publishing plan", value: values.publishingPlan, stepIndex: 2 },
        { label: "Timeline", value: values.timeline, stepIndex: 2 },
        {
          label: "Materials inventory",
          value: values.materialsInventory,
          stepIndex: 2
        },
        {
          label: "Communication preferences",
          value: values.communicationPreferences,
          stepIndex: 2
        },
        { label: "Availability", value: values.availability, stepIndex: 2 },
        { label: "Budget guardrails", value: values.budgetRange || "Not provided", stepIndex: 2 }
      ]
    },
    {
      title: "Voice guardrails",
      fields: [
        { label: "Tone", value: values.voiceTone || "Not provided", stepIndex: 3 },
        {
          label: "Structure & pacing",
          value: values.voiceStructure || "Not provided",
          stepIndex: 3
        },
        {
          label: "Content notes",
          value: values.voiceContent || "Not provided",
          stepIndex: 3
        }
      ]
    }
  ];

  return (
    <div>
      {sections.map((section) => (
        <div key={section.title} className="review-section">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <h3 style={{ margin: 0 }}>{section.title}</h3>
            <button
              type="button"
              className="button ghost"
              onClick={() => onEdit(section.fields[0].stepIndex)}
            >
              Edit
            </button>
          </div>
          <ul className="list-reset" style={{ marginTop: "0.75rem" }}>
            {section.fields.map((field) => (
              <li key={field.label}>
                <strong>{field.label}:</strong> {field.value}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted">
        Saving will create or update the project in Convex, snapshot the blueprint, and
        link the latest version to upcoming realtime sessions.
      </p>
    </div>
  );
}

function validateStep(
  step: (typeof STEPS)[number]["id"],
  values: ProjectIntakeFormState
) {
  const requiredFields = STEP_FIELD_MAP[step];
  const errors: Partial<Record<keyof ProjectIntakeFormState, string>> = {};
  requiredFields.forEach((field) => {
    if (field === "budgetRange") {
      return;
    }
    if (!values[field] || values[field].trim().length === 0) {
      errors[field] = "This field is required";
    }
  });
  return errors;
}

function validateAll(values: ProjectIntakeFormState) {
  return {
    ...validateStep("overview", values),
    ...validateStep("audience", values),
    ...validateStep("plan", values)
  };
}

function findStepIndexForField(field: keyof ProjectIntakeFormState) {
  return STEPS.findIndex((step) => STEP_FIELD_MAP[step.id].includes(field));
}

function mapProjectToForm(project: ProjectSummaryQueryResult): ProjectIntakeFormState {
  const blueprint = project.latestBlueprint;
  return {
    title: project.project.title,
    contentType: project.project.contentType,
    desiredOutcome: blueprint?.desiredOutcome ?? project.project.goal ?? "",
    targetAudience: blueprint?.targetAudience ?? "",
    publishingPlan: blueprint?.publishingPlan ?? "",
    timeline: blueprint?.timeline ?? "",
    materialsInventory: blueprint?.materialsInventory ?? "",
    communicationPreferences: blueprint?.communicationPreferences ?? "",
    availability: blueprint?.availability ?? "",
    budgetRange: blueprint?.budgetRange ?? "",
    voiceTone: blueprint?.voiceGuardrails?.tone ?? "",
    voiceStructure: blueprint?.voiceGuardrails?.structure ?? "",
    voiceContent: blueprint?.voiceGuardrails?.content ?? ""
  };
}

function buildVoiceGuardrails(values: ProjectIntakeFormState) {
  const guardrails = {
    tone: values.voiceTone.trim() || undefined,
    structure: values.voiceStructure.trim() || undefined,
    content: values.voiceContent.trim() || undefined
  };
  if (!guardrails.tone && !guardrails.structure && !guardrails.content) {
    return undefined;
  }
  return guardrails;
}

function buildTitleSuggestion(values: ProjectIntakeFormState) {
  const audience = values.targetAudience.trim() || "Your audience";
  const outcome = values.desiredOutcome.trim() || "your next milestone";
  switch (values.contentType) {
    case "article":
      return `${capitalizeFirstWord(audience)} on ${capitalizeFirstWord(outcome)}`;
    case "biography":
      return `${capitalizeFirstWord(audience)}: The Journey to ${capitalizeFirstWord(outcome)}`;
    default:
      return `Blueprint to ${outcome}`;
  }
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return "not yet saved";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function capitalizeFirstWord(text: string) {
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
