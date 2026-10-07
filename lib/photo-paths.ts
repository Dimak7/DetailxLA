/** Keep existing catalog records on the supplied photos rather than cached legacy imagery. */
const customerPhotos: Record<string, string> = {
  "/brand/editorial/green-car-hand-wash.webp": "/brand/photos/green-car-foam.webp",
  "/brand/editorial/classic-mustang-finish.webp": "/brand/photos/paint-beading.webp",
  "/brand/editorial/vintage-green-lifestyle.webp": "/brand/photos/paint-beading.webp",
  "/brand/editorial/interior-steam.webp": "/brand/photos/interior-cleaning.webp",
  "/brand/editorial/wheel-foam.webp": "/brand/photos/wheel-cleaning.webp",
  "/brand/editorial/vintage-cabin-lifestyle.webp": "/brand/photos/mercedes-interior.webp",
  "/brand/photography/full-detail-studio.webp": "/brand/photos/hand-wash.webp",
  "/brand/photography/exterior-detail.webp": "/brand/photos/green-car-foam.webp",
  "/brand/photography/interior-detail.webp": "/brand/photos/mercedes-interior.webp",
  "/brand/photography/deep-interior.webp": "/brand/photos/interior-cleaning.webp",
  "/brand/photography/paint-correction.webp": "/brand/photos/paint-beading.webp",
  "/brand/photography/ceramic-coating.webp": "/brand/photos/paint-beading.webp",
  "/brand/photography/headlight-restoration.webp": "/brand/photos/mercedes-foam.webp"
};
export function customerPhotoPath(path: string) { return customerPhotos[path] ?? path; }
