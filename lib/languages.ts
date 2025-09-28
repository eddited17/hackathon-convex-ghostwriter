export type LanguageOption = {
  value: string;
  label: string;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
];

export const DEFAULT_LANGUAGE_OPTION: LanguageOption = LANGUAGE_OPTIONS[0];

export function findLanguageOption(value: string | null | undefined): LanguageOption {
  if (!value) return DEFAULT_LANGUAGE_OPTION;
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value.trim());
  return option ?? DEFAULT_LANGUAGE_OPTION;
}
