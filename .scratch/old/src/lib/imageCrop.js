// Crop-to-canvas helper for AvatarCropModal (Prompt 422). react-easy-crop
// hands back a pixel crop rect relative to the source image; this renders
// just that rect into a fixed-size square canvas and returns it as a Blob
// ready to upload — the actual crop math lives here, not in the component.
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

export async function cropImageToBlob(imageSrc, pixelCrop, outputSize = 512) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, outputSize, outputSize
  )
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
}
