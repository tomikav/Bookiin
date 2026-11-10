# Bookiin

> Un lector de libros que no quiere que te diviertas.
> Quiere que leas.

Bookiin es un lector de escritorio para PDFs — novelas, manga, webtoons, lo que
sea que cabe en una página — construido alrededor de una sola idea: cuando estás
leyendo, la interfaz desaparece. En modo zen no queda nada en pantalla. Ni botones,
ni contadores, ni cursor. Solo la página, flotando en la penumbra, y tú.

## Filosofía

La mayoría de los lectores son paneles de control disfrazados de libros. Bookiin
es lo contrario: un cuarto oscuro con una lámpara encendida sobre la mesa.

- **Medianoche.** El tema no se negocia: fondo casi negro, acento dorado tenue,
  tipografía serif de otro siglo. Leer de noche se siente como robando un libro
  de una biblioteca cerrada.
- **El chrome se rinde.** Las barras del lector se desvanecen solas cuando dejas
  de mover el mouse. En modo zen (`Z`) se rinden para siempre hasta que ESC las
  despierte.
- **Sin pasos de más.** Arrastras un PDF, existe. Le pones la portada que tú
  quieras, en el encuadre que tú decidas. Vuelves justo donde quedaste, siempre.

## Características

| | |
|---|---|
| Lectura horizontal | Una página a la vez, con zonas de clic a los lados, flechas o rueda del mouse |
| Lectura vertical | Estilo webtoon: desplazamiento continuo con revelado perezoso de páginas |
| Modo zen | `Z` o el botón de luna. Nada en pantalla excepto la página |
| Modo papel | Filtro sepia cálido para sesiones largas |
| Portadas a medida | Sube cualquier imagen, haz zoom, arrástrala, encuádrala como mejor se vea |
| Progreso persistente | Cada página turnada se guarda. Vuelves y sigues leyendo |
| Biblioteca viva | Búsqueda, orden por título/autor/progreso, estanterías por género, cuadrícula o lista |
| Libros de muestra | Tres obras de dominio público incluidas para estrenar la lámpara |

## Los libros que incluye

Bookiin trae fragmentos de obras de dominio público para que la biblioteca no
nazca vacía:

- *Don Quijote de la Mancha* — Miguel de Cervantes
- *Azul...* — Rubén Darío
- *Rimas* — Gustavo Adolfo Bécquer

Se generan con `scripts/make_samples.py`, un generador de PDFs en Python puro
(sin dependencias): texto latin-1, WinAnsiEncoding, streams comprimidos a mano.
Bórralos cuando lleguen tus propios libros; la biblioteca es tuya.

## Instalación y uso

Requisitos (una sola vez, en Windows):

1. Node.js LTS — https://nodejs.org
2. Para la app nativa: Rust (https://rustup.rs, `rustup default stable-msvc`)
   y Microsoft C++ Build Tools con la carga "Desktop development with C++".

Modo desarrollo (frontend en el navegador):

```
npm install
npm run dev
```

App nativa de escritorio (ventana Tauri; la primera compilación de Rust tarda):

```
npm run tauri dev
```

Instalador final (.exe / .msi), queda en `src-tauri/target/release/bundle/`:

```
npm run tauri build
```

## Controles del lector

| Entrada | Acción |
|---|---|
| Clic en los bordes, `←` / `→`, rueda | Pasar página |
| `Z` | Entrar o salir del modo zen |
| ESC | Salir del zen; si no estás en zen, cerrar el lector |
| Barra inferior | Arrastrar para saltar a cualquier página |
| Lápiz en la portada | Editar título, autor, portada y encuadre; eliminar libro |

## Estructura

```
index.html            markup de la interfaz
src/main.js           biblioteca, lector, IndexedDB, pdf.js
src/style.css         tema Medianoche
public/books/         PDFs de muestra (dominio público)
scripts/              generador de muestras
src-tauri/            shell nativo (Rust + Tauri v2)
```

## Estado

Funcional para uso personal: subir PDFs, leer, personalizar, recuperar progreso.
El almacenamiento local (IndexedDB) es deliberado — tus libros no salen de tu
máquina. En el roadmap: soporte de carpetas de imágenes para manga, gestión de
colecciones más fina y el instalador Tauri como binario estable.

## Licencia

Uso personal. Los textos de muestra son de dominio público.
