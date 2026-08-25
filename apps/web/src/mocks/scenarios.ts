/**
 * Development scenario state controller.
 * Supports query params ?scenario=... or floating dev switcher to simulate edge states.
 */

export type ScenarioType =
  | "normal"
  | "loading"
  | "empty"
  | "validation_error"
  | "request_error"
  | "offline"
  | "forbidden"
  | "retrying"
  | "partial_failure"
  | "expired_hold";

class ScenarioManager {
  private currentScenario: ScenarioType = "normal";
  private listeners: Set<(scenario: ScenarioType) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const s = params.get("scenario") as ScenarioType;
      if (s && this.isValidScenario(s)) {
        this.currentScenario = s;
      }
    }
  }

  public getScenario(): ScenarioType {
    return this.currentScenario;
  }

  public setScenario(scenario: ScenarioType): void {
    this.currentScenario = scenario;
    this.notifyListeners();
  }

  public subscribe(callback: (scenario: ScenarioType) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentScenario);
    }
  }

  private isValidScenario(s: string): s is ScenarioType {
    return [
      "normal",
      "loading",
      "empty",
      "validation_error",
      "request_error",
      "offline",
      "forbidden",
      "retrying",
      "partial_failure",
      "expired_hold",
    ].includes(s);
  }
}

export const scenarioManager = new ScenarioManager();
