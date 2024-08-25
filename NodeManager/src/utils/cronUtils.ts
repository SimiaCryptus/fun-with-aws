interface Schedule {
    minute: ScheduleField;
    hour: ScheduleField;
    dayOfMonth: ScheduleField;
    month: ScheduleField;
    dayOfWeek: ScheduleField;
}

interface ScheduleField {
    type: 'value' | 'range' | 'list' | 'step' | 'any';
    values: number[];
}

function parseField(field: string, min: number, max: number): ScheduleField {
    console.log(`Parsing field: ${field}, min: ${min}, max: ${max}`);
    if (field === '*') {
        console.log('Field is "*", returning any type');
        return {type: 'any', values: []};
    }
    if (field.includes('/')) {
        console.log('Field contains "/", parsing as step');
        const [start, step] = field.split('/');
        const startNum = start === '*' ? min : parseInt(start);
        const values = [];
        for (let i = startNum; i <= max; i += parseInt(step)) {
            values.push(i);
        }
        console.log(`Parsed step values: ${values}`);
        return {type: 'step', values};
    }
    if (field.includes('-')) {
        console.log('Field contains "-", parsing as range');
        const [start, end] = field.split('-').map(Number);
        const values = [];
        for (let i = start; i <= end; i++) {
            values.push(i);
        }
        console.log(`Parsed range values: ${values}`);
        return {type: 'range', values};
    }
    if (field.includes(',')) {
        console.log('Field contains ",", parsing as list');
        return {type: 'list', values: field.split(',').map(Number)};
    }
    console.log('Field is a single value');
    return {type: 'value', values: [parseInt(field)]};
}


export function parseSchedule(cronExpression: string): Schedule {
    console.log(`Parsing cron expression: ${cronExpression}`);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ');
    const schedule: Schedule = {
        minute: parseField(minute, 0, 59),
        hour: parseField(hour, 0, 23),
        dayOfMonth: parseField(dayOfMonth, 1, 31),
        month: parseField(month, 1, 12),
        dayOfWeek: parseField(dayOfWeek, 0, 6)
    };
    console.log('Parsed schedule:', JSON.stringify(schedule, null, 2));
    return schedule;
}

function fieldMatches(field: ScheduleField, value: number): boolean {
    console.log(`Checking if field ${JSON.stringify(field)} matches value ${value}`);
    if (field.type === 'any') return true;
    const matches = field.values.includes(value);
    console.log(`Field ${field.type} ${matches ? 'matches' : 'does not match'} value ${value}`);
    return matches;
}


export function isScheduleMatch(schedule: Schedule, date: Date): boolean {
    console.log(`Checking schedule match for date: ${date}`);
    return (
        fieldMatches(schedule.minute, date.getMinutes()) &&
        fieldMatches(schedule.hour, date.getHours()) &&
        fieldMatches(schedule.dayOfMonth, date.getDate()) &&
        fieldMatches(schedule.month, date.getMonth() + 1) &&
        fieldMatches(schedule.dayOfWeek, date.getDay())
    );
}