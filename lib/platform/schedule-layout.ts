export type TimedShift = {
  start_minute: number;
  end_minute: number;
};

export type ShiftLane<T> = {
  shift: T;
  lane: number;
  lanes: number;
};

// Allocate the first lane that has become free; only intersecting shifts share width.
export function layoutOverlappingShifts<T extends TimedShift>(
  shifts: T[],
): ShiftLane<T>[] {
  const ordered = shifts
    .map((shift, index) => ({ shift, index }))
    .sort(
      (a, b) =>
        a.shift.start_minute - b.shift.start_minute ||
        a.shift.end_minute - b.shift.end_minute ||
        a.index - b.index,
    );
  const result: Array<ShiftLane<T> & { index: number }> = [];
  let group: Array<{ shift: T; index: number }> = [];
  let groupEnd = -Infinity;

  const placeGroup = () => {
    const laneEnds: number[] = [];
    const placed: Array<ShiftLane<T> & { index: number }> = [];
    for (const event of group) {
      let lane = laneEnds.findIndex(
        (laneEnd) => laneEnd <= event.shift.start_minute,
      );
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(event.shift.end_minute);
      } else {
        laneEnds[lane] = event.shift.end_minute;
      }
      placed.push({ shift: event.shift, index: event.index, lane, lanes: 0 });
    }
    result.push(...placed.map((event) => ({ ...event, lanes: laneEnds.length })));
  };

  for (const event of ordered) {
    if (group.length && event.shift.start_minute >= groupEnd) {
      placeGroup();
      group = [];
      groupEnd = -Infinity;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.shift.end_minute);
  }
  if (group.length) placeGroup();

  return result
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...event }) => event);
}
