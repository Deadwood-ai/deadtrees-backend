alter table public.v2_statuses
  add column if not exists is_combined_model_done boolean not null default false;

update public.v2_statuses as status
set is_combined_model_done = true
where exists (
  select 1
  from public.v2_labels as label
  where label.dataset_id = status.dataset_id
    and label.label_source::text = 'model_prediction'
    and label.model_config ->> 'module' = 'deadwood_treecover_combined_v2'
    and label.label_data::text in ('deadwood', 'forest_cover')
  group by label.dataset_id
  having count(distinct label.label_data::text) = 2
);
