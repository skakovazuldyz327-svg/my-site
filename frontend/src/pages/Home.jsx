import ProductGrid from "../components/ProductGrid.jsx";
import { products, waLink } from "../lib/catalog.js";
import VisitForm from "./VisitForm.jsx";

const stripWords = ["матрасы", "кровати", "подушки", "наматрасники", "основания"];

export default function Home() {
  const preview = products.slice(0, 4);

  return (
    <main id="top">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Ателье спокойного сна · с 2021</p>
          <h1>Ортопедический сон<br />без магазинного шума.</h1>
          <p className="lede">
            Меня зовут Жулдыз. Пять лет я подбираю матрасы, кровати и аксессуары так,
            чтобы спина отдыхала, а утро начиналось без «каменной» шеи.
          </p>
          <div className="hero-row">
            <a className="btn btn-solid" href="#visit">Подобрать матрас</a>
            <a className="btn btn-ghost" href="products.html">Смотреть товары</a>
            <p className="hero-note">Личный разбор за 30 минут · без давления купить «самое дорогое»</p>
          </div>
        </div>

        <aside className="hero-card" aria-label="Коротко обо мне">
          <div className="hero-card-stripe" aria-hidden="true"></div>
          <dl>
            <div>
              <dt>Опыт</dt>
              <dd>5 лет</dd>
            </div>
            <div>
              <dt>Возраст</dt>
              <dd>52</dd>
            </div>
            <div>
              <dt>Фокус</dt>
              <dd>Ортопедия</dd>
            </div>
          </dl>
          <p>Не сеть. Один человек, который помнит вашу жёсткость, рост и привычку спать на боку.</p>
        </aside>
      </section>

      <section className="strip" aria-hidden="true">
        <div className="strip-track">
          {[...stripWords, ...stripWords].map((word, index) => <span key={index}>{word}</span>)}
        </div>
      </section>

      <section className="about" id="about">
        <div className="about-copy">
          <p className="num">01</p>
          <h2>Сон — не товар с полки,<br />а посадка под человека.</h2>
          <p>
            Я не продаю «матрас месяца». Сначала спрашиваю, как вы спите, где ноет,
            меняли ли жёсткость за последние годы. Потом предлагаю два-три варианта —
            не десять, чтобы не кружилась голова.
          </p>
          <p>
            Работаю с ортопедическими матрасами, кроватями и аксессуарами: подушки,
            наматрасники, основания. Если модель вам не подойдёт — скажу прямо,
            даже если это меньше чек.
          </p>
          <ul className="facts">
            <li><strong>Жулдыз</strong> · 52 года</li>
            <li>Продажа и подбор с 2021 года</li>
            <li>Ортопедия, а не «мягко и красиво»</li>
          </ul>
        </div>
        <figure className="about-visual">
          <img
            className="about-photo"
            src="images/bed.jpg"
            alt="Спальня с деревянной кроватью, ортопедическим матрасом и льняным бельём"
            width="1024"
            height="768"
            loading="lazy"
          />
          <figcaption>Хороший матрас не бросается в глаза — просто утром ничего не болит.</figcaption>
        </figure>
      </section>

      <section className="catalog" id="catalog">
        <header className="section-head">
          <p className="num">02</p>
          <h2>Что можно взять у меня</h2>
          <p>Не витрина на 400 позиций. Три направления, в которых я уверена.</p>
        </header>

        <article className="item item-wide">
          <p className="item-tag">Основа сна</p>
          <h3>Ортопедические матрасы</h3>
          <p>
            Независимый пружинный блок, латекс, кокос, пены разной плотности.
            Подбираем жёсткость под вес, возраст и любимую позу — не «среднюю для всех».
          </p>
          <ul>
            <li>Односпальные и двуспальные размеры</li>
            <li>Разные зоны жёсткости</li>
            <li>Чехлы, которые реально стираются</li>
          </ul>
        </article>

        <article className="item">
          <p className="item-tag">Каркас</p>
          <h3>Кровати</h3>
          <p>
            Кровати с нормальным основанием, а не «рамой из надежды».
            Смотрим высоту, подъём, место для белья — как живёте, так и ставим.
          </p>
        </article>

        <article className="item">
          <p className="item-tag">Детали</p>
          <h3>Аксессуары</h3>
          <p>
            Подушки под шею, наматрасники, защитные чехлы.
            Мелочь, из-за которой хороший матрас либо работает, либо нет.
          </p>
        </article>
      </section>

      <section className="shop" id="shop">
        <header className="shop-head">
          <div>
            <p className="num">Товары</p>
            <h2>Что есть сейчас</h2>
            <p>Добавьте в заказ. Потом отправите всё одним сообщением в WhatsApp — отвечу лично.</p>
          </div>
          <a className="btn btn-ghost" href="products.html">Все товары →</a>
        </header>
        <ProductGrid items={preview} />
        {!preview.length && <p className="shop-empty">Товары скоро появятся. А пока — просто напишите мне.</p>}
        <div className="shop-more">
          <a className="btn btn-solid" href="products.html">Смотреть все товары ({products.length})</a>
        </div>
      </section>

      <section className="why" id="why">
        <p className="num">03</p>
        <h2>Пять лет — это не слоган.<br />Это сотни спин.</h2>
        <div className="why-grid">
          <blockquote>
            <p>«Мне не нужен самый дорогой матрас в зале. Нужен тот, на котором ваша спина перестанет спорить с утром.»</p>
            <footer>— Жулдыз</footer>
          </blockquote>
          <div className="why-points">
            <p><span>Честно про жёсткость.</span> Если любите «провалиться», ортопедия может не совпасть. Об этом говорю сразу.</p>
            <p><span>Без склада-лабиринта.</span> Консультация спокойная: чай, замеры, вопросы. Не беготня между рядами.</p>
            <p><span>После покупки не пропадаю.</span> Первые недели — самое важное: если «что-то не то», разбираем, а не отмахиваемся.</p>
          </div>
        </div>
      </section>

      <section className="visit" id="visit">
        <div className="visit-copy">
          <p className="num">04</p>
          <h2>Приходите как к человеку,<br />не как в отдел «спальни».</h2>
          <p>
            Напишите, как спите и какой размер кровати. Отвечу сама.
            Если удобнее голосом — оставьте телефон, перезвоню в рабочее время.
          </p>
          <address>
            <a href="tel:+77778492164">+7 (777) 849-21-64</a>
            <a href={waLink}>WhatsApp</a>
            <a href="mailto:zhuldyz.sleep@example.com">zhuldyz.sleep@example.com</a>
          </address>
          <p className="hours">Пн–Сб · 10:00–19:00 · вс — по договорённости</p>
        </div>
        <VisitForm />
      </section>
    </main>
  );
}
