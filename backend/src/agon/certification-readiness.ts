export const AGON_CERTIFICATION_JOBS_REGCLASS = "agon.agon_certification_jobs";

export type AgonCertificationSchemaDatabase = {
  query(sql: string): Promise<{ rows: Array<{ available: boolean }> }>;
};

export async function isAgonCertificationSchemaReady(
  database: AgonCertificationSchemaDatabase,
): Promise<boolean> {
  try {
    const result = await database.query(
      `select to_regclass('${AGON_CERTIFICATION_JOBS_REGCLASS}') is not null as available`,
    );
    return result.rows[0]?.available === true;
  } catch {
    return false;
  }
}
