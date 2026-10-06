'use strict';

const EventPriorityQueue = require('../src/utils/eventPriorityQueue');

describe('EventPriorityQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new EventPriorityQueue();
  });

  test('should enqueue and dequeue events in priority order', () => {
    queue.enqueue('event1', 100);
    queue.enqueue('event2', 50);
    queue.enqueue('event3', 150);
    queue.enqueue('event4', 75);

    expect(queue.size()).toBe(4);
    expect(queue.dequeue()).toBe('event2');
    expect(queue.dequeue()).toBe('event4');
    expect(queue.dequeue()).toBe('event1');
    expect(queue.dequeue()).toBe('event3');
    expect(queue.isEmpty()).toBe(true);
  });

  test('should handle Date objects as priority', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1000);
    const future = new Date(now.getTime() + 1000);

    queue.enqueue('now', now);
    queue.enqueue('past', past);
    queue.enqueue('future', future);

    expect(queue.dequeue()).toBe('past');
    expect(queue.dequeue()).toBe('now');
    expect(queue.dequeue()).toBe('future');
  });

  test('should return null when dequeuing from empty queue', () => {
    expect(queue.dequeue()).toBeNull();
  });

  test('should peek at the earliest event without removing it', () => {
    queue.enqueue('event1', 100);
    queue.enqueue('event2', 50);

    expect(queue.peek()).toBe('event2');
    expect(queue.size()).toBe(2);
  });

  test('should get due events', () => {
    const now = 1000;
    queue.enqueue('past1', 500);
    queue.enqueue('past2', 800);
    queue.enqueue('now', 1000);
    queue.enqueue('future', 1200);

    const due = queue.getDueEvents(now);
    expect(due).toEqual(['past1', 'past2', 'now']);
    expect(queue.size()).toBe(1);
    expect(queue.peek()).toBe('future');
  });

  test('should clear the queue', () => {
    queue.enqueue('event1', 100);
    queue.clear();
    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
  });

  test('should throw error for invalid priority', () => {
    expect(() => queue.enqueue('event', 'invalid')).toThrow();
    expect(() => queue.enqueue('event', null)).toThrow();
  });
});
