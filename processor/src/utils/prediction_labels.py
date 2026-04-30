from typing import Any

from shared.db import login, use_client
from shared.labels import create_label_with_geometries, delete_model_prediction_labels
from shared.logging import LogCategory, LogContext
from shared.logger import logger
from shared.models import LabelDataEnum, LabelPayloadData, LabelSourceEnum, LabelTypeEnum
from shared.settings import settings


def replace_model_prediction_label(
	dataset_id: int,
	user_id: str,
	label_data: LabelDataEnum,
	geometry: dict,
	token: str,
	model_config: dict | None = None,
):
	"""Replace the existing model-prediction label for a dataset and label type."""
	token = login(settings.PROCESSOR_USERNAME, settings.PROCESSOR_PASSWORD)

	deleted_count = delete_model_prediction_labels(
		dataset_id=dataset_id, label_data=label_data, token=token, model_config=model_config
	)
	if deleted_count > 0:
		logger.info(
			f'Deleted {deleted_count} existing prediction labels',
			LogContext(category=LogCategory.DEADWOOD, dataset_id=dataset_id, user_id=user_id, token=token),
		)

	payload = LabelPayloadData(
		dataset_id=dataset_id,
		label_source=LabelSourceEnum.model_prediction,
		label_type=LabelTypeEnum.semantic_segmentation,
		label_data=label_data,
		label_quality=3,
		model_metadata=model_config,
		geometry=geometry,
	)
	return create_label_with_geometries(payload, user_id, token)


def create_versioned_model_prediction_label(
	dataset_id: int,
	user_id: str,
	label_data: LabelDataEnum,
	geometry: dict,
	token: str,
	model_config: dict[str, Any],
):
	"""Create a new model-prediction label and deactivate older labels for the same model.

	This preserves legacy/other-model prediction labels and avoids deleting labels that
	may be referenced by geometry corrections.
	"""
	token = login(settings.PROCESSOR_USERNAME, settings.PROCESSOR_PASSWORD)

	with use_client(token) as client:
		response = (
			client.table(settings.labels_table)
			.select('id,model_config,is_active,version')
			.eq('dataset_id', dataset_id)
			.eq('label_source', LabelSourceEnum.model_prediction.value)
			.eq('label_data', label_data.value)
			.execute()
		)

	existing_matching = [
		label for label in (response.data or []) if _model_config_matches(label.get('model_config'), model_config)
	]
	active_matching = [label for label in existing_matching if label.get('is_active', True)]
	previous_active = max(active_matching, key=lambda label: label.get('version') or 1, default=None)
	next_version = max((label.get('version') or 1 for label in existing_matching), default=0) + 1

	payload = LabelPayloadData(
		dataset_id=dataset_id,
		label_source=LabelSourceEnum.model_prediction,
		label_type=LabelTypeEnum.semantic_segmentation,
		label_data=label_data,
		label_quality=3,
		model_metadata=model_config,
		geometry=geometry,
	)
	label = create_label_with_geometries(payload, user_id, token)

	previous_ids = [existing['id'] for existing in existing_matching if existing['id'] != label.id]
	with use_client(token) as client:
		client.table(settings.labels_table).update(
			{
				'is_active': True,
				'version': next_version,
				'parent_label_id': previous_active['id'] if previous_active else None,
			}
		).eq('id', label.id).execute()

		if previous_ids:
			client.table(settings.labels_table).update({'is_active': False}).in_('id', previous_ids).execute()

	if previous_ids:
		logger.info(
			f'Deactivated {len(previous_ids)} older prediction labels',
			LogContext(category=LogCategory.DEADWOOD, dataset_id=dataset_id, user_id=user_id, token=token),
		)

	return label


def _model_config_matches(label_config: dict[str, Any] | None, model_config: dict[str, Any]) -> bool:
	if not label_config:
		return False
	return all(label_config.get(key) == value for key, value in model_config.items())
