import "../styles/styles.css";
import Layout from "../components/Layout.jsx";
import Product from "../pages/Product.jsx";
import { mount } from "./mount.jsx";

mount(
  <Layout page="product">
    <Product />
  </Layout>
);
