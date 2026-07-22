alter table member_wellness_profiles
  add column if not exists activity_level text not null default 'MODERATE'
  check(activity_level in ('LOW','MODERATE','HIGH'));

alter table member_body_measurements
  add column if not exists secondary_value numeric(6,2);

alter table member_body_measurements
  drop constraint if exists member_body_measurements_metric_type_check,
  drop constraint if exists member_body_measurements_value_check,
  drop constraint if exists member_body_measurements_unit_code_check;

alter table member_body_measurements
  add constraint member_body_measurements_metric_type_check check(
    metric_type in (
      'WEIGHT',
      'WAIST_CIRCUMFERENCE',
      'BODY_FAT_PERCENT',
      'RESTING_HEART_RATE',
      'BLOOD_PRESSURE'
    )
  ),
  add constraint member_body_measurements_value_check check(
    (metric_type='WEIGHT' and value between 20 and 400)
    or (metric_type='WAIST_CIRCUMFERENCE' and value between 30 and 250)
    or (metric_type='BODY_FAT_PERCENT' and value between 1 and 75)
    or (metric_type='RESTING_HEART_RATE' and value between 25 and 250)
    or (metric_type='BLOOD_PRESSURE' and value between 40 and 300)
  ),
  add constraint member_body_measurements_secondary_value_check check(
    (metric_type='BLOOD_PRESSURE' and secondary_value between 30 and 200 and secondary_value<value)
    or (metric_type<>'BLOOD_PRESSURE' and secondary_value is null)
  ),
  add constraint member_body_measurements_unit_code_check check(
    (metric_type='WEIGHT' and unit_code='kg')
    or (metric_type='WAIST_CIRCUMFERENCE' and unit_code='cm')
    or (metric_type='BODY_FAT_PERCENT' and unit_code='percent')
    or (metric_type='RESTING_HEART_RATE' and unit_code='bpm')
    or (metric_type='BLOOD_PRESSURE' and unit_code='mmHg')
  );

create index if not exists member_measurements_type_time_idx
  on member_body_measurements(member_id,metric_type,measured_at desc);

comment on column member_body_measurements.secondary_value is
  'Only used for the paired diastolic value when metric_type is BLOOD_PRESSURE.';
