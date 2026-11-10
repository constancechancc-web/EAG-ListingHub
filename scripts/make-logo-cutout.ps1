# Makes the transparent EAG icons from 'listinghub/assets/EAG LOGO.jpg'.
# Run: $env:SAT=10; $env:WARM=8; $env:GAP=4; powershell -File scripts/make-logo-cutout.ps1 -dir listinghub/assets
param([string]$dir)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Cut {
  // Remove the dark grey square: flood-fill from the border through dark, low-colour pixels.
  // A disc in the middle is protected so the dark centre with the infinity sign and E.A.G stays.
  public static Bitmap Run(string path, int satCut, int warmCut, int gapR) {
    var src = new Bitmap(path);
    int w = src.Width, h = src.Height;
    var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
    src.Dispose();
    var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int stride = data.Stride; var px = new byte[stride * h];
    Marshal.Copy(data.Scan0, px, 0, px.Length);
    // grey = background (the figures are warm beige, the background is neutral grey)
    var grey = new bool[w*h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y*stride + x*4; int b = px[i], g = px[i+1], r = px[i+2];
      int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
      grey[y*w+x] = (mx - mn) < satCut && (r - b) < warmCut;
    }
    // "wide" grey: a whole (2R+1)^2 box is grey -> the fill cannot squeeze through thin gaps into the centre
    var integ = new int[(w+1)*(h+1)];
    for (int y = 0; y < h; y++) { int run = 0; for (int x = 0; x < w; x++) { run += grey[y*w+x] ? 1 : 0; integ[(y+1)*(w+1)+x+1] = integ[y*(w+1)+x+1] + run; } }
    Func<int,int,bool> wide = (x, y) => {
      int x0 = Math.Max(0, x-gapR), y0 = Math.Max(0, y-gapR), x1 = Math.Min(w, x+gapR+1), y1 = Math.Min(h, y+gapR+1);
      int sum = integ[y1*(w+1)+x1] - integ[y0*(w+1)+x1] - integ[y1*(w+1)+x0] + integ[y0*(w+1)+x0];
      return sum == (x1-x0)*(y1-y0);
    };
    var bg = new bool[w*h]; var q = new Queue<int>();
    for (int x = 0; x < w; x++) foreach (int y in new[]{0, h-1}) if (!bg[y*w+x] && wide(x,y)) { bg[y*w+x] = true; q.Enqueue(y*w+x); }
    for (int y = 0; y < h; y++) foreach (int x in new[]{0, w-1}) if (!bg[y*w+x] && wide(x,y)) { bg[y*w+x] = true; q.Enqueue(y*w+x); }
    int[] ddx = {1,-1,0,0}, ddy = {0,0,1,-1};
    while (q.Count > 0) { int p = q.Dequeue(), x = p % w, y = p / w;
      for (int k = 0; k < 4; k++) { int nx = x+ddx[k], ny = y+ddy[k]; if (nx<0||ny<0||nx>=w||ny>=h) continue; int n = ny*w+nx; if (!bg[n] && wide(nx,ny)) { bg[n] = true; q.Enqueue(n); } } }
    // grow back into grey pixels near the reached area (clean edges), limited distance
    var dist = new int[w*h]; for (int i2 = 0; i2 < w*h; i2++) { dist[i2] = bg[i2] ? 0 : int.MaxValue; if (bg[i2]) q.Enqueue(i2); }
    while (q.Count > 0) { int p = q.Dequeue(), x = p % w, y = p / w; if (dist[p] >= gapR + 2) continue;
      for (int k = 0; k < 4; k++) { int nx = x+ddx[k], ny = y+ddy[k]; if (nx<0||ny<0||nx>=w||ny>=h) continue; int n = ny*w+nx; if (grey[n] && dist[n] == int.MaxValue) { dist[n] = dist[p]+1; bg[n] = true; q.Enqueue(n); } } }
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int i = y*stride + x*4, p = y*w + x;
      if (bg[p]) { px[i+3] = 0; continue; }
      int nb = 0; for (int k = 0; k < 4; k++) { int nx = x+ddx[k], ny = y+ddy[k]; if (nx>=0&&ny>=0&&nx<w&&ny<h && bg[ny*w+nx]) nb++; }
      if (nb > 0) px[i+3] = (byte)(nb >= 2 ? 140 : 200); // soft edge
    }
    Marshal.Copy(px, 0, data.Scan0, px.Length);
    bmp.UnlockBits(data);
    return bmp;
  }
  // tight crop to visible pixels
  public static Rectangle Bounds(Bitmap b) {
    int minX = b.Width, minY = b.Height, maxX = 0, maxY = 0;
    for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++) if (b.GetPixel(x, y).A > 20) { if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; }
    return Rectangle.FromLTRB(minX, minY, maxX+1, maxY+1);
  }
}
"@
$cut = [Cut]::Run("$dir\EAG LOGO.jpg", [int]$env:SAT, [int]$env:WARM, [int]$env:GAP)
$r = [Cut]::Bounds($cut)
$side = [Math]::Max($r.Width, $r.Height)
function Save-Icon($size, $pad, $bg, $path) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  if ($bg) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  $inner = $size * (1 - 2*$pad); $scale = $inner / $side
  $dw = $r.Width * $scale; $dh = $r.Height * $scale
  $dest = New-Object System.Drawing.RectangleF((($size-$dw)/2), (($size-$dh)/2), $dw, $dh)
  $g.DrawImage($cut, $dest, (New-Object System.Drawing.RectangleF($r.X, $r.Y, $r.Width, $r.Height)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $out.Dispose()
}
$cream = [System.Drawing.Color]::FromArgb(255, 247, 243, 234)
Save-Icon 512 0.02 $null "$dir\eag-logo-cutout.png"
Save-Icon 32  0.0  $null "$dir\favicon-32.png"
Save-Icon 192 0.04 $null "$dir\icon-192.png"
Save-Icon 512 0.04 $null "$dir\icon-512.png"
Save-Icon 512 0.16 $cream "$dir\icon-maskable-512.png"
Save-Icon 180 0.08 $cream "$dir\apple-touch-icon.png"
$cut.Dispose()
"crop $($r.X),$($r.Y) $($r.Width)x$($r.Height)"
