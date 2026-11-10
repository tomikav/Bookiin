# -*- coding: latin-1 -*-
"""Genera PDFs de muestra (obras de dominio publico) sin dependencias externas."""
import zlib, textwrap, os

def esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

def para(text, width=78):
    return textwrap.wrap(" ".join(text.split()), width)

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "books")


def make_pdf(path, title, author, pages):
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join("%d 0 R" % (5 + 2 * i) for i in range(len(pages)))
    objs.append(("<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(pages))).encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>")
    for i, lines in enumerate(pages):
        content = "BT /F2 20 Tf 60 760 Td (%s) Tj ET\n" % esc(title)
        content += "BT /F2 12 Tf 60 742 Td (%s) Tj ET\n" % esc(author)
        content += "0.85 w 60 730 m 535 730 l S\n"
        y = 700
        for ln in lines:
            content += "BT /F1 11 Tf 60 %d Td (%s) Tj ET\n" % (y, esc(ln))
            y -= 17
        content += "BT /F1 9 Tf 520 40 Td (%d) Tj ET" % (i + 1)
        data = zlib.compress(content.encode("latin-1", errors="replace"))
        objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                    b"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents %d 0 R >>"
                    % (6 + 2 * i))  # cada pagina (5+2i) va seguida de su stream (6+2i)
        objs.append(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream")
    out = b"%PDF-1.4\n"
    offs = []
    for n, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % n + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offs:
        out += ("%010d 00000 n \n" % off).encode()
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    path = os.path.join(OUT_DIR, path)
    open(path, "wb").write(out)
    print(path, os.path.getsize(path), "bytes,", len(pages), "paginas")

# --- Textos de dominio publico (fragmentos) ---

quijote_p1 = """En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho
tiempo que vivia un hidalgo de los de lanza en astillero, adarga antigua, rocin flaco
y galgo corredor. Una olla de algo mas vaca que carnero, salpicon las mas noches,
duelos y quebrantos los sabados, lentejas los viernes, algun palomino de anadidura
los domingos, consumian las tres partes de su hacienda.
El resto della concluyan sayo de velarte, calzas de velludo para las fiestas, con sus
pantuflos de lo mismo, y los dias de entresemana se honraba con su vellori de lo mas
fino. Tenia en su casa una ama que pasaba de los cuarenta, y una sobrina que no
llegaba a los veinte, y un mozo de campo y plaza, que asi ensillaba el rocin como
tomaba la podadera.
Frisaba la edad de nuestro hidalgo con los cincuenta anos; era de complexion recia,
seco de carnes, enjuto de rostro; gran madrugador y amigo de la caza. Quieren
decir que tenia el sobrenombre de Quijada o Quesada, que en esto hay alguna
diferencia en los autores que deste caso escriben; aunque por conjeturas
verosimiles se deja entender que se llamaba Quijana."""

quijote_p2 = """Es, pues, de saber que este sobredicho hidalgo, los ratos que estaba ocioso,
que eran los mas del ano, se daba a leer libros de caballerias, con tanta aficion y
gusto, que olvido casi de todo punto el ejercicio de la caza y aun la administracion
de su hacienda; y llego a tanto su curiosidad y desatino en esto, que vendio muchas
anegas de tierra de sementera para comprar libros de caballerias en que leer.
Y asi, del poco dormir y del mucho leer se le seco el celebro de manera que vino a
perder el juicio; y pareciole convenible y necesario, asi para el aumento de su honra
como para el servicio de su republica, hacerse caballero andante, e irse por todo el
mundo con sus armas y caballo a buscar las aventuras y a ejercitarse en todo
aquello que el habia leido que los caballeros andantes ejercitaban.
Limpiadas, pues, sus armas, hecho del morrion celada, puesto nombre a su rocin, y
confirmandose a si mismo, se dio a entender que no le faltaba otra cosa sino buscar
una dama de quien enamorarse, porque el caballero andante sin amores era arbol sin
hojas y sin fruto."""

dario_p1 = """La princesa esta triste. Que tendra la princesa?
Los suspiros se escapan de su boca de fresa,
que ha perdido la risa, que ha perdido el color.
La princesa esta palida en su silla de oro,
esta mudo el teclado de su clave de oro,
y en un vaso olvidada se desmaya una flor.
El jardinero pomposo cruza por la galeria,
y a la princesa envuelta en un manto de armino,
ve que la palidez vuelve a su rostro la flor.
La princesa no rie, la princesa no siente;
la princesa persigue por el cielo de Oriente
la libelula vaga de una vaga ilusion."""

dario_p2 = """Que tienen los ninos? A los ninos se acerca
el valle y la fuente, el cielo y la tierra;
en su aire cae la mariposa y las flores
y en la faz juvenil cae el aire y la luz.
La princesa esta triste. Que tendra la princesa?
Que tiene el aire de esa tarde de primavera?
La fuente de su sed, de su sed infinita,
que la copa vacia con su boca de fresa,
no la sacia de sed, no la mata de sed.
La copa de oro y el clavel de su boca
no le sirven de sed, y aun se muere de sed."""

becquer_p1 = """Yo se un himno gigante y extrano
que anuncia en la noche del alma una aurora,
y estas paginas sonaron un dia en mi oido...
Yo se un himno gigante y extrano.
El era amado, era amada; el tenia un himno.
El tenia en su frente una luz y una aurora.
Que alimento la vida del poeta?

Cuando sobre el pecho ahogaba
la Discordia, y la noche sombria
oprimia el corazon del vate,
sobre su frente brillaba aun la luz."""

becquer_p2 = """Volveran las oscuras golondrinas
en tu balcon sus nidos a colgar,
y otra vez con el ala a sus cristales
jugando llamaran.
Mas aquellas que el vuelo refrenaban
tu hermosura y mi dicha a contemplar,
aquellas que aprendieron nuestros nombres...
esas... no volveran!
Volveran las tupidas madreselvas
del jardin muros las esquinas
a abrir sus flores, y otra vez seran
mas hermosas aun."""

pages_q = [para(quijote_p1), para(quijote_p2)]
pages_d = [para(dario_p1), para(dario_p2)]
pages_b = [para(becquer_p1), para(becquer_p2)]

make_pdf("quijote.pdf", "Don Quijote de la Mancha", "Miguel de Cervantes - dominio publico", pages_q)
make_pdf("azul.pdf", "Azul... (fragmentos)", "Ruben Dario - dominio publico", pages_d)
make_pdf("rimas.pdf", "Rimas (fragmentos)", "Gustavo Adolfo Becquer - dominio publico", pages_b)
