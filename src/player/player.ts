export default interface Player<T> {
  reset(): void;
  setData(data: T, options?: any): void;
  play(): Promise<void>;
  stop(): void;
  setSpeed(speed: number): void;
  setLoop(loop: number): void;
  release(): void;
}
