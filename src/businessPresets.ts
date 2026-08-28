// "Для бизнеса" start-screen tiles — each drops a Prompt→Генерация фото chain pre-configured
// for one vertical (nano-banana-pro, 2K, 9:16). The prompt text below is sent directly to the
// image model, not shown as UI copy, so — like the AdaptNode format-adaptation prompts and the
// assistant system prompts in electron/main.ts — it deliberately stays untranslated English
// rather than going through src/i18n.ts.
export type BusinessPresetKey = 'horeca' | 'auto' | 'apartment' | 'furniture' | 'electronics';

export const BUSINESS_PRESET_ORDER: BusinessPresetKey[] = [
  'horeca',
  'auto',
  'apartment',
  'furniture',
  'electronics',
];

export const BUSINESS_PRESET_PROMPTS: Record<BusinessPresetKey, string> = {
  auto:
    'Transform the uploaded vehicle photo into a premium professional automotive photograph. ' +
    'Enhance only the overall image quality while strictly preserving the original environment, ' +
    'location, background, composition, framing, camera position, perspective, viewing angle, ' +
    'and vehicle placement.\n\n' +
    'Preserve the exact vehicle model, body shape, proportions, paint color, wheels, headlights, ' +
    'grille, windows, interior, accessories, license plate, badges, and every recognizable ' +
    'detail. Do not redesign, replace, move, rotate, or modify the vehicle.\n\n' +
    'Professionally improve exposure, white balance, dynamic range, contrast, sharpness, ' +
    'clarity, color accuracy, and fine details. Enhance the natural reflections on the body ' +
    'panels, improve the appearance of the paint, glass, chrome, headlights, wheels, and tires. ' +
    'Use realistic professional automotive lighting and natural color grading that matches the ' +
    'existing environment and direction of light.\n\n' +
    'Remove only minor photographic imperfections such as digital noise, compression artifacts, ' +
    'lens distortion, chromatic aberration, excessive glare, dust, and slight motion blur. ' +
    'Preserve realistic shadows, reflections, weather conditions, road surface, surrounding ' +
    'objects, and atmospheric depth.\n\n' +
    'The final result must look like a high-end professional automotive advertising photograph ' +
    'captured at the same location and at the same moment with a premium full-frame camera and ' +
    'professional lens: photorealistic, naturally detailed, clean, sharp, high resolution.\n\n' +
    'Do not change or replace the background. Do not change the location, weather, time of day, ' +
    'architecture, road, landscape, or surrounding objects. Do not crop or extend the frame. Do ' +
    'not change the camera angle, focal length, perspective, composition, vehicle position, ' +
    'wheel direction, license plate, color, design, or proportions. Do not add or remove people, ' +
    'vehicles, objects, text, logos, lights, smoke, or reflections.\n\n' +
    'The uploaded image is a strict visual reference. This is professional photo enhancement ' +
    'only, not image regeneration or reinterpretation.',
  horeca:
    'Transform the uploaded photo into a premium professional food photography image. Preserve ' +
    'the exact dish, ingredients, portion size, arrangement, plate, colors, and recognizable ' +
    'details from the original photo.\n\n' +
    'Place the dish on a clean seamless white studio background with a subtle white surface ' +
    'beneath it. Use soft diffused commercial studio lighting, a large softbox from the ' +
    'front-left, gentle fill light, natural appetizing highlights, realistic soft contact ' +
    'shadows, and accurate white balance.\n\n' +
    'Enhance the natural texture, freshness, moisture, crispness, and fine details of the food ' +
    'without changing the recipe or adding new ingredients. Make the dish look fresh and ' +
    'appetizing but completely realistic. Premium restaurant menu and food-delivery advertising ' +
    'quality, photorealistic, high resolution, sharp focus, clean composition.\n\n' +
    'Do not change the shape of the dish, do not replace the plate, do not add decorations, ' +
    'text, logos, cutlery, ingredients, steam, or additional objects. No artificial saturation, ' +
    'no plastic-looking food, no excessive retouching.',
  apartment:
    'Transform the uploaded interior photo into a premium professional interior photography ' +
    'image. Preserve the exact room layout, architecture, furniture, materials, colors, décor, ' +
    'proportions, and placement of every object.\n\n' +
    'Create a bright, clean, white-dominant studio-quality presentation while keeping the ' +
    'interior realistic and recognizable. Make the walls and neutral background surfaces clean ' +
    'white where appropriate, without removing the original architectural features. Use soft ' +
    'natural-looking diffused light, balanced exposure, realistic global illumination, gentle ' +
    'shadows, accurate material textures, clean vertical lines, and corrected lens distortion.\n\n' +
    'Produce the look of a high-end interior design magazine and premium real-estate catalog: ' +
    'photorealistic, spacious, elegant, sharp, clean, and professionally color-graded. Preserve ' +
    'realistic depth and do not overexpose white surfaces.\n\n' +
    'Do not redesign the room, move or replace furniture, change the architecture, add windows, ' +
    'decorations, plants, lights, or new objects. No fisheye distortion, no exaggerated ' +
    'wide-angle perspective, no artificial HDR, no plastic textures.',
  furniture:
    'Transform the uploaded furniture or interior product photo into a premium studio catalog ' +
    'photograph. Preserve the exact design, shape, proportions, construction, color, material, ' +
    'stitching, texture, and all recognizable details of the original object.\n\n' +
    'Isolate the product and place it on a seamless pure white studio background with a subtle ' +
    'white floor. Use soft diffused commercial lighting, controlled highlights, accurate ' +
    'material rendering, realistic texture, and a soft contact shadow beneath the product. Keep ' +
    'the original camera angle and perspective.\n\n' +
    'High-end furniture catalog photography, photorealistic, clean, elegant, extremely ' +
    'detailed, sharp focus, high resolution.\n\n' +
    'Do not redesign the product, change its material or color, remove details, add décor, ' +
    'text, people, logos, or additional objects. Do not distort the proportions or make the ' +
    'object float.',
  electronics:
    'Transform the uploaded product photo into a premium professional electronics studio ' +
    'photograph. Preserve the exact product model, shape, proportions, color, materials, ' +
    'screen, buttons, ports, controls, branding, labels, and every recognizable technical ' +
    'detail.\n\n' +
    'Isolate the product and place it on a seamless pure white studio background with a subtle ' +
    'white surface. Use precise commercial product lighting: a large softbox, clean controlled ' +
    'highlights, realistic reflections on glass, metal, and plastic, accurate edges, fine ' +
    'surface textures, balanced exposure, and a soft natural contact shadow beneath the ' +
    'product.\n\n' +
    'Keep the original camera angle and product orientation. Remove only dust, fingerprints, ' +
    'scratches caused by poor photography, visual noise, and background distractions. Premium ' +
    'e-commerce and technology advertising quality, photorealistic, extremely detailed, sharp ' +
    'focus, high resolution.\n\n' +
    'Do not redesign the device, change its dimensions, buttons, ports, screen size, interface, ' +
    'color, logo, or construction. Do not invent details, add accessories, cables, text, hands, ' +
    'people, or decorative objects. No floating product unless it is already floating in the ' +
    'reference.',
};
