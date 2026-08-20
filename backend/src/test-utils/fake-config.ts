// Spec-only ConfigService stub: returns values from a plain record, nothing else.
// Shared by app-setup.spec and mail.module.spec.
export class FakeConfigService {
  private readonly values: Record<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = values;
  }

  get<T>(key: string): T | undefined {
    // eslint-disable-next-line security/detect-object-injection -- test stub; keys are hardcoded in the specs
    return this.values[key] as unknown as T | undefined;
  }
}
