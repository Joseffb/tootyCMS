export type ProfileSectionRow = {
  label: string;
  value: string;
};

export type ProfileSection = {
  id: string;
  title: string;
  description?: string;
  rows?: ProfileSectionRow[];
};
