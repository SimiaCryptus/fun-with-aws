export class RateLimiter {
    private queue: ((value: void | PromiseLike<void>) => void)[] = [];
     private running = 0;
 
     constructor(private maxConcurrent: number) {}
 
     async add(fn: () => Promise<void>): Promise<void> {
         if (this.running >= this.maxConcurrent) {
            await new Promise<void>(resolve => this.queue.push(resolve as (value: void | PromiseLike<void>) => void));
         }
         this.running++;
         try {
             await fn();
         } finally {
             this.running--;
             if (this.queue.length > 0) {
                 const next = this.queue.shift();
                 next?.();
             }
         }
     }
 }