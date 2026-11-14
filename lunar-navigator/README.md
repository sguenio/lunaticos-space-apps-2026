# Lunar Landing Site Navigator — Equipo Lunáticos

Compara sitios y fechas de alunizaje con datos reales de NASA/JPL Horizons:
altura del Sol y de la Tierra sobre el horizonte, tiempo hasta el ocaso, ventanas
de energía y de comunicación, y qué pasa si la misión se atrasa.

## Cómo correrlo

1. Instalar Node.js 20 o más nuevo.
2. En esta carpeta:

   ```
   npm install
   npm run assets
   npm run dev
   ```

   `npm run assets` descarga a `public/` el mapa (`moon.jpg`) y el relieve (`moon-bump.jpg`)
   de la Luna desde NASA. Si se saltean ese paso, la app los pide a NASA cada vez a través
   del proxy de Vite; si tampoco hay internet, la Luna se ve gris lisa.
3. Abrir la dirección que muestra la terminal (normalmente http://localhost:5173).

La primera carga tarda unos segundos: baja los datos de cada sitio desde Horizons,
de a una consulta por vez. Después quedan guardados en el navegador (localStorage).

### Más nitidez en la Luna

El JPG más grande que publica NASA es de 2048 px. Para más detalle, bajar
`lroc_color_16bit_srgb_8k.tif` de https://svs.gsfc.nasa.gov/4720 , convertirlo a JPG
(por ejemplo con GIMP o Photoshop) y guardarlo como `public/moon.jpg`.

## Modos y pestañas

Después de la pantalla de inicio se elige el modo (se puede cambiar arriba a la derecha):

- **Simple**: lenguaje claro para cualquier persona. Responde "¿hay luz del Sol?" y
  "¿puede hablar con la Tierra?", con el globo, la línea de tiempo y el rover.
- **Avanzado**: todas las pestañas.
  - **Resumen**: globo, lista de sitios, métricas y comparador rápido.
  - **Cielo** (también en modo simple): vuelta completa al horizonte del sitio, con el Sol y la
    Tierra en su altura y dirección reales y su recorrido en la ventana.
  - **Datos**: registro en vivo de las consultas a Horizons y la tabla horaria que se está usando.
  - **Calendario** (también en modo simple): horas de luz y de señal día por día, lista de
    amaneceres, atardeceres y cambios de señal, y temperatura estimada del suelo.
  - **Análisis**: todos los sitios lado a lado y, para el sitio elegido, gráfico de altura del
    Sol y la Tierra, azimuts, flujo solar, noche y corte de comunicación más largos, y descarga CSV.
  - **Comparar**: una misma misión, dos escenarios. A es el plan original y B una alternativa
    (otro sitio u otro atraso); abajo dice qué se gana o se pierde y cuál conviene.
  - **Planificación**: escenarios de atraso para un sitio.
  - **Rover**: simulador para manejar con W/A/S/D.
  - **Ajustes**: tema, idioma, ventana del puntaje y borrado de datos guardados.

## Simulador de rover

Controles: `W A S D` o flechas para manejar, `Espacio` freno, `L` luces, `C` cámara,
`G` mostrar u ocultar la ruta, `Q`/`E` retroceder o avanzar 6 horas, `R` reiniciar. Arrastrar con el mouse gira la cámara
y la rueda acerca o aleja. En pantallas táctiles aparecen botones.

Qué es real y qué no (está también en `src/Rover.jsx`):

| Real | Modelo |
|---|---|
| Dirección y altura del Sol y la Tierra (Horizons, mismo sitio y fecha que la app) | Terreno generado por computadora, con semilla fija por sitio. **No es el relieve real** |
| Gravedad lunar de 1,62 m/s², con la poca tracción que eso implica | Batería: números simplificados para jugar |
| Sombras calculadas contra el terreno con el Sol real; cielo negro sin atmósfera | Enlace: línea de visión a la Tierra contra el terreno generado |

La línea de colores es la ruta sugerida al próximo punto: evita pendientes de más de 25° y
prefiere tramos con sol y señal (verde: las dos, amarillo: una, rojo: ninguna).

El objetivo es llegar a los 5 puntos de ciencia (columnas celestes) sin quedarse sin batería: en la sombra
no carga, y sin línea de visión a la Tierra no hay enlace.

## De dónde sale cada dato

| Dato | Fuente |
|---|---|
| Elevación del Sol y la Tierra en cada sitio, hora por hora | JPL Horizons, observador en la superficie lunar (`CENTER='coord@301'`, `QUANTITIES='4'`) |
| Iluminación del globo y posición del Sol/Tierra alrededor | JPL Horizons, puntos subsolar y subterrestre de la Luna (`QUANTITIES='14,15'`) |
| Mapa de la Luna | NASA SVS CGI Moon Kit: mosaico de color de la cámara de LRO |
| Relieve (sombras de cráteres) | NASA SVS CGI Moon Kit: altimetría LOLA, exagerada unas 3 veces para que se lea |

Lo que calcula la app a partir de esos datos (en `src/horizons.js`):

- **Sunset in / Earthset in**: cuándo la elevación cruza 0°, interpolando entre horas.
- **Power / Communication**: porcentaje de los próximos 14 días (configurable en Ajustes) con el Sol / la Tierra sobre el horizonte.
- **Best window**: el atraso (de día) que maximiza Power + Communication.

## Límites conocidos (decirlos en el pitch)

- **Temperatura**: es una estimación de equilibrio radiativo para suelo plano al sol, no una
  medición ni un modelo térmico del robot.
- **Solo modo oscuro.**
- **Sin relieve**: Horizons usa una Luna esférica lisa. En el polo sur, montañas y cráteres
  cambian mucho el horizonte real. Siguiente paso: horizontes calculados con LOLA.
- **Coordenadas a verificar**: Malapert Massif y Shackleton Rim están marcadas con `~` en `src/App.jsx`.
- **Relieve solo visual**: las sombras del globo usan LOLA, pero las horas de salida y puesta no.
- **Publicar en internet**: el navegador no puede llamar directo a Horizons. En desarrollo lo
  resuelve el proxy de `vite.config.js` (también con `npm run preview`). Si lo suben a un
  hosting, necesitan una regla equivalente que reenvíe `/horizons` a
  `https://ssd.jpl.nasa.gov/api/horizons.api` (y correr antes `npm run assets`).

## Archivos

- `src/App.jsx` — pantalla, lista de sitios, tarjeta de métricas, línea de tiempo.
- `src/horizons.js` — consultas a Horizons, caché y cálculo de métricas.
- `src/Globe.jsx` — globo de la Luna (WebGL) con pines, Sol y Tierra.
- `src/Rover.jsx` — simulador de rover (WebGL, física y terreno).
- `src/i18n.js` — textos en español e inglés.
- `scripts/download-assets.mjs` — descarga del mapa y el relieve.
- `src/styles.css` — estilos.
