import { ThaiIdCardPayload } from "@thai-id-intake/shared-types";

export type SmartCardReturnData = {
  citizenID?: string;
  titleTH?: string;
  titleEN?: string;
  fullNameTH?: string;
  fullNameEN?: string;
  firstNameTH?: string;
  firstNameEN?: string;
  lastNameTH?: string;
  lastNameEN?: string;
  dateOfBirth?: string;
  gender?: string;
  cardIssuer?: string;
  issueDate?: string;
  expireDate?: string;
  address?: string;
  photoAsBase64Uri?: string;
};

export function normalizeCard(raw: Record<string, unknown>): ThaiIdCardPayload {
  return {
    citizenId: String(raw.citizenId ?? raw.citizenID ?? raw.cid ?? raw.personalId ?? ""),
    titleTh: raw.titleTh ? String(raw.titleTh) : raw.titleTH ? String(raw.titleTH) : undefined,
    titleEn: raw.titleEn ? String(raw.titleEn) : raw.titleEN ? String(raw.titleEN) : undefined,
    fullNameTh: raw.fullNameTh ? String(raw.fullNameTh) : raw.fullNameTH ? String(raw.fullNameTH) : undefined,
    fullNameEn: raw.fullNameEn ? String(raw.fullNameEn) : raw.fullNameEN ? String(raw.fullNameEN) : undefined,
    firstNameTh: raw.firstNameTh ? String(raw.firstNameTh) : raw.firstNameTH ? String(raw.firstNameTH) : undefined,
    firstNameEn: raw.firstNameEn ? String(raw.firstNameEn) : raw.firstNameEN ? String(raw.firstNameEN) : undefined,
    lastNameTh: raw.lastNameTh ? String(raw.lastNameTh) : raw.lastNameTH ? String(raw.lastNameTH) : undefined,
    lastNameEn: raw.lastNameEn ? String(raw.lastNameEn) : raw.lastNameEN ? String(raw.lastNameEN) : undefined,
    dateOfBirth: raw.dateOfBirth ? String(raw.dateOfBirth) : undefined,
    gender: raw.gender ? String(raw.gender) : undefined,
    cardIssuer: raw.cardIssuer ? String(raw.cardIssuer) : undefined,
    issueDate: raw.issueDate ? String(raw.issueDate) : undefined,
    expireDate: raw.expireDate ? String(raw.expireDate) : undefined,
    address: raw.address ? String(raw.address) : undefined,
    photoAsBase64Uri: raw.photoAsBase64Uri ? String(raw.photoAsBase64Uri) : undefined
  };
}
