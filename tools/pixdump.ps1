param(
  [string]$Src,
  [string]$Raw,
  [string]$Out,
  [int]$W, [int]$H, [int]$Stride
)
Add-Type -AssemblyName System.Drawing
if ($Src -ne '') {
  $img = [System.Drawing.Image]::FromFile($Src)
  $bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImageUnscaled($img, 0, 0)
  $g.Dispose()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  [System.IO.File]::WriteAllBytes($Raw, $bytes)
  "$($bmp.Width) $($bmp.Height) $($data.Stride)" | Set-Content -Encoding ascii ($Raw + '.meta')
  Write-Host "dumped $($bmp.Width)x$($bmp.Height) stride=$($data.Stride) -> $Raw"
  $bmp.Dispose(); $img.Dispose()
} else {
  $bytes = [System.IO.File]::ReadAllBytes($Raw)
  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $W * $H * 4)
  $bmp.UnlockBits($data)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $Out ($W x $H)"
}
