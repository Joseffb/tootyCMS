const CORE_DEFAULT_DESCRIPTIONS: Record<string, string> = {
  post: "Default core post type",
  page: "Default core page type",
};

export const dataDomainDescriptionSettingKey = (dataDomainId: number) =>
  `data_domain_${Number(dataDomainId)}_description`;

export const dataDomainPermalinkSettingKey = (dataDomainId: number) =>
  `data_domain_${Number(dataDomainId)}_permalink`;

export const dataDomainLabelSettingKey = (dataDomainId: number) =>
  `data_domain_${Number(dataDomainId)}_label`;

export const dataDomainKeySettingKey = (dataDomainId: number) =>
  `data_domain_${Number(dataDomainId)}_key`;

export const dataDomainShowInMenuSettingKey = (dataDomainId: number) =>
  `data_domain_${Number(dataDomainId)}_show_in_menu`;

export const getCoreDataDomainDefaultDescription = (domainKey: string) => {
  const key = String(domainKey || "").trim().toLowerCase();
  return CORE_DEFAULT_DESCRIPTIONS[key] || "";
};

export const resolveDataDomainDescription = (input: {
  domainKey: string;
  siteDescription?: string | null;
  globalDescription?: string | null;
}) => {
  const siteDescription = String(input.siteDescription || "").trim();
  if (siteDescription) return siteDescription;

  const coreDefault = getCoreDataDomainDefaultDescription(input.domainKey);
  if (coreDefault) return coreDefault;

  return String(input.globalDescription || "").trim();
};
