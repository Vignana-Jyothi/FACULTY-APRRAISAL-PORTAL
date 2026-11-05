// Shared department option list for project-reporting multi-selects (Cat 2.5).
// Institution-wide list from the project-reporting form, distinct from the
// active-appraisal Department table. "Other" is handled as a free-text entry.
export const PROJECT_DEPARTMENTS = [
  'AE', 'BioT', 'EEE', 'ECE and VLSI', 'EIE', 'ME', 'CSE & CSBS',
  'CSE (AIML) & IoT and R&AI', 'CSE(CYE, DS) and AI & DS', 'IT',
  'Chemistry', 'English', 'Mathematics and Management Science', 'Physics',
] as const;
