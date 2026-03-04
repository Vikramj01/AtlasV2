import type { JourneyDefinition, PlatformConfig, SpecFormat } from '../../types/journey';
import { generateGTMDataLayer } from './generators/gtmDataLayer';
import { generateWalkerOSFlow } from './generators/walkerosFlow';
import { generateValidationSpec } from './generators/validationSpec';
import { saveGeneratedSpec, getJourneyWithDetails } from '../database/journeyQueries';

export async function generateAndSaveSpecs(
  journeyId: string,
  userId: string,
  formats?: SpecFormat[],
): Promise<Record<SpecFormat, unknown>> {
  const details = await getJourneyWithDetails(journeyId, userId);
  if (!details) throw new Error('Journey not found');

  const { journey, stages, platforms } = details;

  const definition: JourneyDefinition = {
    id: journey.id,
    name: journey.name,
    business_type: journey.business_type,
    implementation_format: journey.implementation_format,
    stages,
  };

  const platformConfigs: PlatformConfig[] = platforms.map((p) => ({
    platform: p.platform,
    is_active: p.is_active,
    measurement_id: p.measurement_id,
    config: p.config,
  }));

  const toGenerate = formats ?? resolveFormats(journey.implementation_format);
  const results: Partial<Record<SpecFormat, unknown>> = {};

  for (const format of toGenerate) {
    let specData: unknown;

    if (format === 'gtm_datalayer') {
      specData = generateGTMDataLayer(definition, platformConfigs);
    } else if (format === 'walkeros_flow') {
      specData = generateWalkerOSFlow(definition, platformConfigs);
    } else if (format === 'validation_spec') {
      specData = generateValidationSpec(definition, platformConfigs);
    } else {
      continue;
    }

    await saveGeneratedSpec(journeyId, format, specData);
    results[format] = specData;
  }

  return results as Record<SpecFormat, unknown>;
}

function resolveFormats(implementationFormat: string): SpecFormat[] {
  const formats: SpecFormat[] = ['validation_spec'];
  if (implementationFormat === 'gtm' || implementationFormat === 'both') formats.push('gtm_datalayer');
  if (implementationFormat === 'walkeros' || implementationFormat === 'both') formats.push('walkeros_flow');
  return formats;
}
