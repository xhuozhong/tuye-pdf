from pathlib import Path

from PIL import Image, ImageDraw


image = Image.new("RGBA", (256, 256))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((4, 4, 251, 251), radius=53, fill="#24554c")
draw.line([(76, 166), (76, 66), (158, 66)], fill="#d5e9db", width=12, joint="curve")
draw.rounded_rectangle((102, 92, 184, 198), radius=10, outline="white", width=12)
draw.line([(120, 164), (138, 147), (158, 166)], fill="white", width=10, joint="curve")
draw.ellipse((151, 114, 166, 129), fill="white")
image.save(Path(__file__).with_name("tuye.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
